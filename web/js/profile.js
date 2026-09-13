/**
 * KomuniPH Lite - Profile UI
 */

import { profileApi, isAuthenticated, getCurrentUserProfile, setCurrentUserProfile } from './api.js';
import { navigate } from './app.js';

let currentProfile = null;
let customizationDirty = false;

/**
 * Convert a hex color (#RRGGBB) to rgba with given opacity.
 * If the color is already rgba/rgb, update its alpha channel.
 */
function toRgbaWithOpacity(color, opacity) {
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)/, `rgba($1, $2, $3, ${opacity})`);
  }
  if (color.startsWith('rgb(')) {
    const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${opacity})`;
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color;
}

/**
 * Extract a hex color (#RRGGBB) from various color formats for color inputs.
 */
function toHexColor(color) {
  if (color.startsWith('#')) return color;
  if (color.startsWith('rgba') || color.startsWith('rgb')) {
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1]).toString(16).padStart(2, '0');
      const g = parseInt(m[2]).toString(16).padStart(2, '0');
      const b = parseInt(m[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  return '#fff7ec';
}

/**
 * Create avatar HTML
 */
function createAvatar(username, displayName, photoUrl, size = 5) {
  if (photoUrl) {
    return `<img src="${photoUrl}" alt="${displayName}" class="avatar large" style="width:${size}rem;height:${size}rem">`;
  }
  const initials = (displayName || username || '?').charAt(0).toUpperCase();
  return `<div class="avatar large" style="width:${size}rem;height:${size}rem">${initials}</div>`;
}

/**
 * Render the profile page
 */
export function renderProfilePage() {
  if (!isAuthenticated()) {
    navigate('/login');
    return '';
  }

  return `
    <div class="profile-frame" id="profile-frame">
      <!-- Header -->
      <header class="profile-header" id="profile-header">
        <div class="profile-header-inner">
          <h1 class="profile-brand">KomuniPH</h1>
          <p class="profile-tagline">Your personal space on KomuniPH</p>
        </div>
      </header>

      <!-- Navigation -->
      <nav class="profile-nav" id="profile-nav">
        <a href="#/home" class="profile-nav-link">Home</a>
        <a href="#/profile" class="profile-nav-link profile-nav-active">My Profile ▼</a>
        <a href="#/connections" class="profile-nav-link">My Connections ▼</a>
        <a href="#/explore" class="profile-nav-link">Explore ▼</a>
        <a href="#/search" class="profile-nav-link">Search</a>
        <a href="#/messages" class="profile-nav-link">Messages</a>
        <a href="#/settings" class="profile-nav-link">Settings</a>
        <button class="profile-nav-link profile-nav-link-logout" onclick="window.handleLogout()">Log Out</button>
      </nav>

      <!-- Quote/Status Strip -->
      <div class="profile-status-strip" id="profile-status-strip">
        Your personal space on KomuniPH
      </div>

      <!-- Main content two-column layout -->
      <div class="profile-content" id="profile-content">
        <!-- Main column -->
        <div class="profile-main" id="profile-main">
          <!-- Profile module -->
          <div class="profile-module" id="profile-module">
            <div class="profile-module-header">
              Profile
              <span></span>
            </div>
            <div class="profile-module-body" id="profile-module-body">
              <!-- Large profile photo -->
              <img class="profile-photo-large" id="profile-photo-large"
                   src="" alt="Profile photo"
                   style="display:none">
              <!-- Fallback initials -->
              <div class="profile-photo-large" id="profile-photo-initials"
                   style="display:none; background: var(--theme-accent, var(--kp-teal)); color: white;">
                ?
              </div>
              <div style="clear:both"></div>

              <h2 class="profile-name" id="profile-name"></h2>
              <p class="profile-username" id="profile-username"></p>
              <p class="profile-nickname" id="profile-nickname"></p>

              <div class="profile-info-grid" id="profile-info-grid">
                <!-- Identity fields will be populated by JS -->
              </div>

              <div class="profile-actions" id="profile-actions">
                <button class="profile-action-btn" onclick="window.startEditProfile()">Edit Profile</button>
                <button class="profile-action-btn" onclick="window.openCustomization()">Customize Profile</button>
              </div>
            </div>
          </div>

          <!-- Personal Information Module -->
          <div class="profile-module" id="personal-info-module">
            <div class="profile-module-header">
              Personal Information
              <span></span>
            </div>
            <div class="profile-module-body" id="personal-info-body">
              <div class="profile-info-grid">
                <div>
                  <span class="profile-info-label">Name:</span>
                </div>
                <span class="profile-info-value" id="profile-info-name"></span>
                <br>
                <div>
                  <span class="profile-info-label">Nickname:</span>
                </div>
                <span class="profile-info-value" id="profile-info-nickname"></span>
                <br>
                <div>
                  <span class="profile-info-label">Location:</span>
                </div>
                <span class="profile-info-value" id="profile-info-location"></span>
                <br>
                <div>
                  <span class="profile-info-label">About Me:</span>
                </div>
                <span class="profile-info-value" id="profile-info-bio"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar column -->
        <div class="profile-sidebar" id="profile-sidebar">
          <!-- Friend Space module -->
          <div class="sidebar-module" id="friend-space-module">
            <div class="sidebar-module-header">
              Friend Space
            </div>
            <div class="sidebar-module-body" id="friend-space-body">
              <div class="friends-grid" id="friends-grid">
                <!-- Friends will appear here -->
              </div>
              <div class="coming-soon" id="friends-coming-soon">
                Your friends will appear here.
                Coming soon.
              </div>
            </div>
          </div>

          <!-- Photo Gallery module -->
          <div class="sidebar-module" id="photo-gallery-module">
            <div class="sidebar-module-header">
              Photo Gallery
            </div>
            <div class="sidebar-module-body" id="photo-gallery-body">
              <div class="photo-gallery" id="photo-gallery">
                <div class="photo-gallery-empty" id="photo-gallery-empty">
                  No photos yet.
                </div>
              </div>
            </div>
          </div>

          <!-- Video Box module -->
          <div class="sidebar-module" id="video-box-module">
            <div class="sidebar-module-header">
              Video Box
            </div>
            <div class="sidebar-module-body" id="video-box-body">
              <div class="video-box" id="video-box">
                <div class="video-box-empty" id="video-box-empty">
                  No videos yet.
                  Coming soon.
                </div>
              </div>
            </div>
          </div>

          <!-- Blog module -->
          <div class="sidebar-module" id="blog-module">
            <div class="sidebar-module-header">
              Blog
            </div>
            <div class="sidebar-module-body" id="blog-body">
              <div class="blog-module" id="blog-module-content">
                <div class="blog-module-empty" id="blog-module-empty">
                  Latest Blog Entry
                  <br><br>
                  No blog entries yet.
                  Coming soon.
                </div>
              </div>
            </div>
          </div>

          <!-- Music module -->
          <div class="sidebar-module" id="music-module">
            <div class="sidebar-module-header">
              Music
            </div>
            <div class="sidebar-module-body" id="music-body">
              <div class="music-module" id="music-module-content">
                <div class="music-module-empty" id="music-module-empty">
                  No track selected.
                  Coming soon.
                </div>
              </div>
            </div>
          </div>

          <!-- Scraps/Comments module -->
          <div class="sidebar-module" id="scraps-module">
            <div class="sidebar-module-header">
              Scraps / Comments
            </div>
            <div class="sidebar-module-body" id="scraps-body">
              <div class="scraps-module" id="scraps-content">
                <div class="scraps-module-empty" id="scraps-empty">
                  Coming soon.
                </div>
              </div>
            </div>
          </div>

          <!-- Community module -->
          <div class="sidebar-module" id="community-module">
            <div class="sidebar-module-header">
              Community
            </div>
            <div class="sidebar-module-body" id="community-body">
              <div class="community-module" id="community-content">
                <div class="community-module-header">
                  Community
                </div>
                <p class="coming-soon" style="font-size:0.75rem; color:var(--theme-text-secondary, var(--kp-ink-soft));">
                  Coming soon.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <footer class="profile-footer" id="profile-footer">
        ~ Welcome to my KomuniPH space ~
      </footer>

      <!-- Theme customization panel -->
      <div id="theme-customization-panel" class="theme-panel" style="display:none">
        <div class="theme-panel-header">
          <h2>Customize Profile</h2>
          <button class="theme-panel-close" onclick="window.closeCustomization()">&times;</button>
        </div>

        <div class="theme-panel-body">
          <div class="theme-section">
            <h3>Background</h3>
            <div class="theme-radio-group">
              <label class="theme-radio">
                <input type="radio" name="bg-type" value="color" checked onchange="window.setBgType('color')">
                <span>Solid Color</span>
              </label>
              <label class="theme-radio">
                <input type="radio" name="bg-type" value="gradient" onchange="window.setBgType('gradient')">
                <span>Gradient</span>
              </label>
              <label class="theme-radio">
                <input type="radio" name="bg-type" value="image" onchange="window.setBgType('image')">
                <span>Background Image</span>
              </label>
            </div>

            <div id="bg-color-controls" class="theme-controls">
              <label class="theme-label">Background Color</label>
              <input type="color" id="theme-backgroundColor" value="#fff7ec" onchange="window.updatePreview()">
            </div>

            <div id="bg-gradient-controls" class="theme-controls" style="display:none">
              <label class="theme-label">Gradient</label>
              <select id="theme-backgroundGradient" onchange="window.updatePreview()">
                <option value="">None</option>
                <option value="linear-gradient(135deg, #111827, #312e81)">Dark Indigo</option>
                <option value="linear-gradient(135deg, #0f172a, #1e293b)">Slate</option>
                <option value="linear-gradient(135deg, #1e1b4b, #312e81)">Deep Purple</option>
                <option value="linear-gradient(135deg, #0e6e6e, #134e4a)">Teal</option>
                <option value="linear-gradient(135deg, #7b5aa6, #4c1d95)">Ube</option>
              </select>
            </div>

            <div id="bg-image-controls" class="theme-controls" style="display:none">
              <label class="theme-label">Upload Background</label>
              <input type="file" id="theme-background-input" accept="image/jpeg,image/png,image/webp" onchange="window.handleBackgroundUpload(this)">
              <div id="theme-background-status" class="upload-status"></div>
              <div id="theme-background-preview" class="theme-bg-preview" style="display:none"></div>
            </div>

            <div class="theme-row">
              <div class="theme-field">
                <label class="theme-label">Position</label>
                <select id="theme-backgroundPosition" onchange="window.updatePreview()">
                  <option value="center">Center</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="top left">Top Left</option>
                  <option value="top center">Top Center</option>
                  <option value="top right">Top Right</option>
                  <option value="center left">Center Left</option>
                  <option value="center center">Center Center</option>
                  <option value="center right">Center Right</option>
                  <option value="bottom left">Bottom Left</option>
                  <option value="bottom center">Bottom Center</option>
                  <option value="bottom right">Bottom Right</option>
                </select>
              </div>
              <div class="theme-field">
                <label class="theme-label">Size</label>
                <select id="theme-backgroundSize" onchange="window.updatePreview()">
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <div class="theme-field">
                <label class="theme-label">Repeat</label>
                <select id="theme-backgroundRepeat" onchange="window.updatePreview()">
                  <option value="no-repeat">No Repeat</option>
                  <option value="repeat">Repeat</option>
                  <option value="repeat-x">Repeat X</option>
                  <option value="repeat-y">Repeat Y</option>
                </select>
              </div>
            </div>
          </div>

          <div class="theme-section">
            <h3>Colors</h3>
            <div class="theme-row">
              <div class="theme-field">
                <label class="theme-label">Text</label>
                <input type="color" id="theme-textColor" value="#2a2130" onchange="window.updatePreview()">
              </div>
              <div class="theme-field">
                <label class="theme-label">Muted Text</label>
                <input type="color" id="theme-mutedTextColor" value="#6b6072" onchange="window.updatePreview()">
              </div>
              <div class="theme-field">
                <label class="theme-label">Accent</label>
                <input type="color" id="theme-accentColor" value="#0e6e6e" onchange="window.updatePreview()">
              </div>
            </div>
          </div>

          <div class="theme-section">
            <h3>Card</h3>
            <div class="theme-row">
              <div class="theme-field">
                <label class="theme-label">Card Color</label>
                <input type="color" id="theme-cardBackground" value="#fff7ec" onchange="window.updatePreview()">
              </div>
              <div class="theme-field">
                <label class="theme-label">Border Color</label>
                <input type="color" id="theme-cardBorderColor" value="#f0dfc8" onchange="window.updatePreview()">
              </div>
            </div>
            <div class="theme-row">
              <div class="theme-field">
                <label class="theme-label">Transparency: <span id="theme-cardOpacity-value">0.95</span></label>
                <input type="range" id="theme-cardOpacity" min="0" max="1" step="0.01" value="0.95" oninput="window.updatePreview()">
              </div>
              <div class="theme-field">
                <label class="theme-label">Corner Radius: <span id="theme-cardBorderRadius-value">1.75rem</span></label>
                <input type="range" id="theme-cardBorderRadius" min="0" max="100" step="1" value="28" oninput="window.updatePreview()">
              </div>
            </div>
          </div>
        </div>

        <div class="theme-panel-footer">
          <button class="btn btn-secondary" onclick="window.resetCustomization()">Reset to Default</button>
          <button class="btn btn-secondary" onclick="window.closeCustomization()">Cancel</button>
          <button class="btn btn-primary" onclick="window.saveCustomization()">Save</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Apply theme background to the profile page frame.
 * Sets CSS variables and background-image on .profile-frame
 * so the user's background covers the entire profile page.
 */
function applyProfileBackground(profile) {
  const frame = document.getElementById('profile-frame');
  if (!frame) return;

  const theme = profile?.theme && profile.theme.config ? profile.theme.config : {};
  const custom = profile?.theme && profile.theme.custom ? profile.theme.custom : {};

  const bgImage = custom.backgroundImage || theme.backgroundImage || '';
  const bgGradient = custom.backgroundGradient || theme.backgroundGradient || '';
  const bgColor = custom.backgroundColor || theme.background || theme.backgroundColor || '#fff7ec';
  const bgPosition = custom.backgroundPosition || theme.backgroundPosition || 'center';
  const bgRepeat = custom.backgroundRepeat || theme.backgroundRepeat || 'no-repeat';
  const bgSize = custom.backgroundSize || theme.backgroundSize || 'cover';

  const cardBg = custom.cardBackground || theme.cardBackground || 'rgba(255, 247, 236, 0.95)';
  const hasBackground = !!bgImage || !!bgGradient;
  const defaultCardOpacity = hasBackground ? 0.8 : 0.95;
  const cardOpacity = custom.cardOpacity != null ? custom.cardOpacity : defaultCardOpacity;
  const effectiveCardOpacity = hasBackground ? Math.min(cardOpacity, 0.85) : cardOpacity;
  const cardBgRgba = toRgbaWithOpacity(cardBg, effectiveCardOpacity);
  const cardBorderColor = custom.cardBorderColor || theme.border || '#f0dfc8';
  const cardBorderRadius = custom.cardBorderRadius || theme.cardRadius || '1.75rem';
  const cardShadow = theme.cardShadow || '0 20px 60px -20px rgba(42, 33, 48, 0.35)';
  const textColor = custom.textColor || theme.text || '#2a2130';
  const mutedTextColor = custom.mutedTextColor || theme.textSecondary || '#6b6072';
  const accentColor = custom.accentColor || theme.accent || '#0e6e6e';

  // Set CSS variables on the frame so all child elements inherit them
  frame.style.setProperty('--theme-background', bgColor);
  frame.style.setProperty('--theme-card-background', cardBgRgba);
  frame.style.setProperty('--theme-card-opacity', effectiveCardOpacity);
  frame.style.setProperty('--theme-card-border-color', cardBorderColor);
  frame.style.setProperty('--theme-card-radius', cardBorderRadius);
  frame.style.setProperty('--theme-card-shadow', cardShadow);
  frame.style.setProperty('--theme-text', textColor);
  frame.style.setProperty('--theme-text-secondary', mutedTextColor);
  frame.style.setProperty('--theme-accent', accentColor);

  // Apply the background to the frame (the profile page), NOT the card
  frame.style.backgroundImage = '';
  frame.style.background = '';
  if (bgImage) {
    frame.style.backgroundImage = `url(${bgImage})`;
    frame.style.backgroundColor = bgColor;
    frame.style.backgroundPosition = bgPosition;
    frame.style.backgroundRepeat = bgRepeat;
    frame.style.backgroundSize = bgSize;
  } else if (bgGradient) {
    frame.style.background = bgGradient;
  } else {
    frame.style.background = bgColor;
  }
}

/**
 * Load profile
 */
window.loadProfile = async function() {
  try {
    const profile = await profileApi.getOwnProfile();
    currentProfile = profile;
    applyProfileBackground(profile);
    // The profile content is already in the HTML frame,
    // so we just need to update the data in existing elements
    const displayName = profile.display_name || profile.username;
    const nickname = profile.nickname || '';
    const alias = profile.alias_enabled && profile.alias ? profile.alias : '';

    // Update profile name display in the frame
    const nameDisplay = profile.display_name || profile.username;
    const nameEl = document.getElementById('profile-name');
    const usernameEl = document.getElementById('profile-username');
    const nicknameEl = document.getElementById('profile-nickname');

    if (nameEl) nameEl.textContent = nameDisplay;
    if (usernameEl) usernameEl.textContent = `@${profile.username || ''}`;
    if (nicknameEl) nicknameEl.textContent = nickname ? `"${nickname}"` : '';

    // Update personal info module
    const infoName = displayName;
    const infoNickname = nickname;
    const infoLocation = profile.real_name ? (profile.real_name + ', Philippines') : '';
    const infoBio = profile.bio || '';

    const infoNameEl = document.getElementById('profile-info-name');
    const infoNicknameEl = document.getElementById('profile-info-nickname');
    const infoLocationEl = document.getElementById('profile-info-location');
    const infoBioEl = document.getElementById('profile-info-bio');

    if (infoNameEl) infoNameEl.textContent = infoName;
    if (infoNicknameEl) infoNicknameEl.textContent = infoNickname;
    if (infoLocationEl) infoLocationEl.textContent = infoLocation;
    if (infoBioEl) infoBioEl.textContent = infoBio;

    // Update friends coming soon visibility
    const friendsComingSoon = document.getElementById('friends-coming-soon');
    if (friendsComingSoon) {
      // Check if there are any friends - for now always show coming soon
      friendsComingSoon.style.display = 'block';
    }

    // Update photo large preview
    const profilePhotoLarge = document.getElementById('profile-photo-large');
    const profilePhotoInitials = document.getElementById('profile-photo-initials');
    if (profile.profile_photo_url) {
      if (profilePhotoLarge) {
        profilePhotoLarge.src = profile.profile_photo_url;
        profilePhotoLarge.alt = displayName;
        profilePhotoLarge.style.display = 'block';
      }
      if (profilePhotoInitials) {
        profilePhotoInitials.style.display = 'none';
      }
    } else {
      if (profilePhotoLarge) profilePhotoLarge.style.display = 'none';
      if (profilePhotoInitials) {
        profilePhotoInitials.style.display = 'block';
        profilePhotoInitials.textContent = (displayName || '?').charAt(0).toUpperCase();
      }
    }

    // Update sidebar/avatar references if they exist (for other pages)
    const sidebarImg = document.getElementById('sidebar-avatar-img');
    const sidebarInitials = document.getElementById('sidebar-avatar-initials');
    const sidebarName = document.getElementById('sidebar-display-name');
    const sidebarAlias = document.getElementById('sidebar-alias');

    if (sidebarImg) {
      if (profile.profile_photo_url) {
        sidebarImg.src = profile.profile_photo_url;
        sidebarImg.alt = displayName;
        sidebarImg.style.display = 'block';
      }
    }
    if (sidebarInitials) {
      sidebarInitials.textContent = (displayName || '?').charAt(0).toUpperCase();
      if (profile.profile_photo_url) {
        sidebarInitials.style.display = 'none';
      }
    }
    if (sidebarName) sidebarName.textContent = displayName;
    if (sidebarAlias) sidebarAlias.textContent = alias ? `@${alias}` : '';

  } catch (err) {
    console.error('[PROFILE] Load profile error:', err);
    // Show error in the status strip
    const statusStrip = document.getElementById('profile-status-strip');
    if (statusStrip) {
      statusStrip.textContent = 'Failed to load profile: ' + (err.message || 'Unknown error');
      statusStrip.style.color = '#dc2626';
    }
  }
};

/**
 * Render profile content
 */
function renderProfileContent(profile) {
  // Identity fields with safe defaults (PROFILE-04)
  const firstName = profile.first_name || '';
  const middleName = profile.middle_name || '';
  const lastName = profile.last_name || '';
  const nickname = profile.nickname || '';
  const displayName = profile.display_name || profile.username || '';
  const username = profile.username || '';
  const aliasValue = profile.alias || '';
  const bioValue = profile.bio || '';

  // Build full name for display
  const fullNameParts = [firstName, middleName, lastName].filter(Boolean);
  const fullName = fullNameParts.join(' ') || displayName;

  // Determine the photo URL
  const photoUrl = profile.profile_photo_url || '';

  // Build name display
  const nameDisplay = displayName ? displayName : (firstName ? firstName + ' ' + (lastName || '') : username);

  // Nickname display
  const nicknameDisplay = nickname ? `"${nickname}"` : '';

  // Build personal info display
  const infoName = displayName || (firstName + ' ' + (middleName ? middleName + ' ' : '') + (lastName || ''));
  const infoNickname = nickname || '';
  const infoLocation = profile.real_name ? (profile.real_name + ', Philippines') : '';
  const infoBio = bioValue || '';

  // Profile photo HTML - large photo
  let photoHtml = '';
  if (photoUrl) {
    photoHtml = `<img class="profile-photo-large" id="profile-photo-large"
                    src="${escapeHtml(photoUrl)}"
                    alt="${escapeHtml(displayName)}">`;
  } else {
    photoHtml = `<div class="profile-photo-large" id="profile-photo-initials"
                   style="width:290px;height:400px;background: var(--theme-accent, var(--kp-teal)); color: white; display:flex; align-items:center; justify-content:center; font-size:2rem;">
                    ?
                </div>`;
  }

  // Theme
  const theme = profile.theme && profile.theme.config ? profile.theme.config : {};
  const bgImage = theme.backgroundImage || '';
  const bgGradient = theme.backgroundGradient || '';
  const bgColor = theme.background || theme.backgroundColor || '#fff7ec';
  const bgPosition = theme.backgroundPosition || 'center';
  const bgRepeat = theme.backgroundRepeat || 'no-repeat';
  const bgSize = theme.backgroundSize || 'cover';
  const cardBg = theme.cardBackground || 'rgba(255, 247, 236, 0.95)';
  const cardOpacity = theme.cardOpacity != null ? theme.cardOpacity : 0.95;
  const cardBgRgba = toRgbaWithOpacity(cardBg, cardOpacity);
  const cardBorderColor = theme.cardBorderColor || theme.border || '#f0dfc8';
  const cardBorderRadius = theme.cardBorderRadius || theme.cardRadius || '1.75rem';
  const cardShadow = theme.cardShadow || '0 20px 60px -20px rgba(42, 33, 48, 0.35)';
  const textColor = theme.textColor || theme.text || '#2a2130';
  const mutedTextColor = theme.mutedTextColor || theme.textSecondary || '#6b6072';
  const accentColor = theme.accentColor || theme.accent || '#0e6e6e';

  const themeStyle = [
    `--theme-background: ${bgColor}`,
    `--theme-card-background: ${cardBgRgba}`,
    `--theme-card-opacity: ${cardOpacity}`,
    `--theme-card-border-color: ${cardBorderColor}`,
    `--theme-card-radius: ${cardBorderRadius}`,
    `--theme-card-shadow: ${cardShadow}`,
    `--theme-text: ${textColor}`,
    `--theme-text-secondary: ${mutedTextColor}`,
    `--theme-accent: ${accentColor}`
  ].join('; ');

  // Build profile info grid HTML
  let infoGridHtml = '';
  if (infoName) {
    infoGridHtml += `<div><span class="profile-info-label">Name:</span> <span class="profile-info-value">${escapeHtml(infoName)}</span></div>`;
  }
  if (infoNickname) {
    infoGridHtml += `<div><span class="profile-info-label">Nickname:</span> <span class="profile-info-value">${escapeHtml(infoNickname)}</span></div>`;
  }
  if (infoLocation) {
    infoGridHtml += `<div><span class="profile-info-label">Location:</span> <span class="profile-info-value">${escapeHtml(infoLocation)}</span></div>`;
  }
  if (infoBio) {
    infoGridHtml += `<div><span class="profile-info-label">About Me:</span> <span class="profile-info-value">${escapeHtml(infoBio)}</span></div>`;
  }
  if (!infoName && !infoNickname && !infoLocation && !infoBio) {
    infoGridHtml = `<div><span class="profile-info-value" style="color:var(--theme-text-secondary, var(--kp-ink-soft));">No information yet.</span></div>`;
  }

  // Build action buttons
  let actionsHtml = `
    <button class="profile-action-btn" onclick="window.startEditProfile()">Edit Profile</button>
    <button class="profile-action-btn" onclick="window.openCustomization()">Customize Profile</button>
  `;

  return `
    <div class="profile-card" style="${themeStyle}">
      <div class="profile-photo-section">
        ${photoHtml}
        <div class="photo-upload-form">
          <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
          <button class="btn btn-secondary" onclick="document.getElementById('photo-input').click()">Choose Photo</button>
          <button class="btn btn-primary" id="upload-btn" style="display:none" onclick="window.uploadPhoto()">Upload</button>
          <div id="upload-status" class="upload-status"></div>
        </div>
      </div>
      <div id="profile-view">
        <h2 class="profile-name">${escapeHtml(nameDisplay)}</h2>
        <p class="profile-username">@${escapeHtml(username)}</p>
        ${nicknameDisplay ? `<p class="profile-nickname">${escapeHtml(nicknameDisplay)}</p>` : ''}
        ${profile.alias
          ? `<p class="profile-alias">Alias: ${escapeHtml(profile.alias)}</p>`
          : '<p class="profile-alias empty">No alias set.</p>'
        }
        ${profile.bio
          ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>`
          : '<p class="profile-bio empty">No bio yet.</p>'
        }
        ${actionsHtml}
      </div>
      <div id="profile-edit" style="display:none">
        <div class="form-group">
          <label for="edit-first-name">First Name *</label>
          <input type="text" id="edit-first-name" maxlength="100" value="${escapeHtml(firstName)}" placeholder="Enter your first name">
        </div>
        <div class="form-group">
          <label for="edit-middle-name">Middle Name</label>
          <input type="text" id="edit-middle-name" maxlength="100" value="${escapeHtml(middleName)}" placeholder="Enter your middle name (optional)">
        </div>
        <div class="form-group">
          <label for="edit-last-name">Last Name *</label>
          <input type="text" id="edit-last-name" maxlength="100" value="${escapeHtml(lastName)}" placeholder="Enter your last name">
        </div>
        <div class="form-group">
          <label for="edit-nickname">Nickname</label>
          <input type="text" id="edit-nickname" maxlength="50" value="${escapeHtml(nickname)}" placeholder="Enter a nickname (optional)">
        </div>
        <div class="form-group">
          <label for="edit-display-name">Display Name *</label>
          <input type="text" id="edit-display-name" maxlength="100" value="${escapeHtml(displayName)}" placeholder="How you want to be known">
        </div>
        <div class="form-group">
          <label for="edit-alias">Alias</label>
          <input type="text" id="edit-alias" maxlength="50" value="${escapeHtml(aliasValue)}">
        </div>
        <div class="form-group">
          <label for="edit-bio">Bio</label>
          <textarea id="edit-bio" rows="3" maxlength="500">${escapeHtml(bioValue)}</textarea>
        </div>
        <div id="edit-profile-error" class="error-banner" style="display:none"></div>
        <div class="edit-actions">
          <button class="btn btn-primary" id="save-profile-btn" onclick="window.saveProfile()">Save Changes</button>
          <button class="btn btn-secondary" id="cancel-profile-btn" onclick="window.cancelEditProfile()">Cancel</button>
        </div>
      </div>
    </div>
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
 * Wire up the profile-photo file input: show the Upload button only when
 * a file has been selected. This must be (re)run after every render of
 * renderProfileContent() because the inputs are recreated each time.
 *
 * Defensive: if the elements don't exist yet (e.g. content area still being
 * built) the function simply returns without error.
 */
function setupPhotoInput() {
  const photoInput = document.getElementById('photo-input');
  const uploadBtn = document.getElementById('upload-btn');
  if (!photoInput || !uploadBtn) return;

  // Ensure the upload button reflects the current selection
  const hasFile = !!(photoInput.files && photoInput.files.length > 0);
  uploadBtn.style.display = hasFile ? 'inline-block' : 'none';

  photoInput.addEventListener('change', function () {
    const fileSelected = !!(this.files && this.files.length > 0);
    uploadBtn.style.display = fileSelected ? 'inline-block' : 'none';
  });
}

/**
 * Enter edit mode (FEED-07)
 */
window.startEditProfile = function() {
  const view = document.getElementById('profile-view');
  const edit = document.getElementById('profile-edit');
  const error = document.getElementById('edit-profile-error');
  if (!view || !edit) return;

  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  view.style.display = 'none';
  edit.style.display = 'block';
};

/**
 * Restore pre-edit values and leave edit mode (FEED-07)
 */
window.cancelEditProfile = function() {
  const view = document.getElementById('profile-view');
  const edit = document.getElementById('profile-edit');
  const error = document.getElementById('edit-profile-error');
  if (!view || !edit) return;

  // PROFILE-04: Include identity fields in cancel restore
  const firstName = (currentProfile && currentProfile.first_name) || '';
  const middleName = (currentProfile && currentProfile.middle_name) || '';
  const lastName = (currentProfile && currentProfile.last_name) || '';
  const nickname = (currentProfile && currentProfile.nickname) || '';
  const displayName = (currentProfile && (currentProfile.display_name || currentProfile.username)) || '';
  const aliasValue = (currentProfile && currentProfile.alias) || '';
  const bioValue = (currentProfile && currentProfile.bio) || '';

  const firstNameInput = document.getElementById('edit-first-name');
  const middleNameInput = document.getElementById('edit-middle-name');
  const lastNameInput = document.getElementById('edit-last-name');
  const nicknameInput = document.getElementById('edit-nickname');
  const nameInput = document.getElementById('edit-display-name');
  const aliasInput = document.getElementById('edit-alias');
  const bioInput = document.getElementById('edit-bio');
  if (firstNameInput) firstNameInput.value = firstName;
  if (middleNameInput) middleNameInput.value = middleName;
  if (lastNameInput) lastNameInput.value = lastName;
  if (nicknameInput) nicknameInput.value = nickname;
  if (nameInput) nameInput.value = displayName;
  if (aliasInput) aliasInput.value = aliasValue;
  if (bioInput) bioInput.value = bioValue;

  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }
  edit.style.display = 'none';
  view.style.display = 'block';
};

/**
 * Save profile changes (FEED-07)
 */
window.saveProfile = async function() {
  const saveBtn = document.getElementById('save-profile-btn');
  const cancelBtn = document.getElementById('cancel-profile-btn');
  const error = document.getElementById('edit-profile-error');

  const showEditError = (message) => {
    if (!error) return;
    error.textContent = message;
    error.style.display = 'block';
  };

  // PROFILE-04: Include identity fields
  const firstName = (document.getElementById('edit-first-name')?.value || '').trim();
  const middleName = (document.getElementById('edit-middle-name')?.value || '').trim();
  const lastName = (document.getElementById('edit-last-name')?.value || '').trim();
  const nickname = (document.getElementById('edit-nickname')?.value || '').trim();
  const displayName = (document.getElementById('edit-display-name')?.value || '').trim();
  const alias = (document.getElementById('edit-alias')?.value || '').trim();
  const bio = (document.getElementById('edit-bio')?.value || '').trim();

  // PROFILE-04: Validate first_name (required)
  if (!firstName) {
    showEditError('First name is required');
    return;
  }
  if (firstName.length > 100) {
    showEditError('First name must be less than 100 characters');
    return;
  }

  // PROFILE-04: Validate last_name (required)
  if (!lastName) {
    showEditError('Last name is required');
    return;
  }
  if (lastName.length > 100) {
    showEditError('Last name must be less than 100 characters');
    return;
  }

  // PROFILE-04: Validate middle_name (optional, max 100)
  if (middleName.length > 100) {
    showEditError('Middle name must be less than 100 characters');
    return;
  }

  // PROFILE-04: Validate nickname (optional, max 50)
  if (nickname.length > 50) {
    showEditError('Nickname must be less than 50 characters');
    return;
  }

  if (!displayName) {
    showEditError('Display name is required');
    return;
  }
  if (displayName.length > 100) {
    showEditError('Display name must be less than 100 characters');
    return;
  }
  if (!alias) {
    showEditError('Alias is required');
    return;
  }
  if (alias.length > 50) {
    showEditError('Alias must be less than 50 characters');
    return;
  }
  if (bio.length > 500) {
    showEditError('Bio must be less than 500 characters');
    return;
  }

  if (saveBtn && saveBtn.disabled) return;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    // PROFILE-04: Include identity fields in update
    const updated = await profileApi.updateProfile({
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      nickname: nickname || null,
      display_name: displayName,
      alias,
      bio,
    });

    currentProfile = updated;
    applyProfileBackground(updated);
  } catch (err) {
    showEditError(err.message || 'Failed to update profile');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
    if (cancelBtn) cancelBtn.disabled = false;
  }
};

/**
 * Open theme customization panel
 */
window.openCustomization = function() {
  const panel = document.getElementById('theme-customization-panel');
  if (!panel) return;

  const theme = currentProfile && currentProfile.theme && currentProfile.theme.config ? currentProfile.theme.config : {};
  const custom = currentProfile && currentProfile.theme && currentProfile.theme.custom ? currentProfile.theme.custom : {};

  // Reset controls to current custom values or defaults
  const bgType = custom.backgroundImage ? 'image' : custom.backgroundGradient ? 'gradient' : 'color';
  const bgColor = custom.backgroundColor || theme.background || '#fff7ec';
  const bgGradient = custom.backgroundGradient || '';
  const bgPosition = custom.backgroundPosition || 'center';
  const bgRepeat = custom.backgroundRepeat || 'no-repeat';
  const bgSize = custom.backgroundSize || 'cover';
  const textColor = custom.textColor || theme.text || '#2a2130';
  const mutedTextColor = custom.mutedTextColor || theme.textSecondary || '#6b6072';
  const accentColor = custom.accentColor || theme.accent || '#0e6e6e';
  const cardBg = custom.cardBackground || theme.cardBackground || '#fff7ec';
  const hasBackground = !!custom.backgroundImage || !!custom.backgroundGradient;
  const cardOpacity = custom.cardOpacity != null ? custom.cardOpacity : (hasBackground ? 0.8 : 0.95);
  const cardBorderColor = custom.cardBorderColor || theme.border || '#f0dfc8';
  const cardBorderRadius = custom.cardBorderRadius || parseInt(theme.cardRadius) || 28;

  const setRadio = (name, value) => {
    const radio = panel.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  };

  setRadio('bg-type', bgType);

  const bgColorInput = document.getElementById('theme-backgroundColor');
  if (bgColorInput) bgColorInput.value = toHexColor(bgColor);

  const bgGradientSelect = document.getElementById('theme-backgroundGradient');
  if (bgGradientSelect) bgGradientSelect.value = bgGradient;

  const bgPositionSelect = document.getElementById('theme-backgroundPosition');
  if (bgPositionSelect) bgPositionSelect.value = bgPosition;

  const bgRepeatSelect = document.getElementById('theme-backgroundRepeat');
  if (bgRepeatSelect) bgRepeatSelect.value = bgRepeat;

  const bgSizeSelect = document.getElementById('theme-backgroundSize');
  if (bgSizeSelect) bgSizeSelect.value = bgSize;

  const textColorInput = document.getElementById('theme-textColor');
  if (textColorInput) textColorInput.value = toHexColor(textColor);

  const mutedTextColorInput = document.getElementById('theme-mutedTextColor');
  if (mutedTextColorInput) mutedTextColorInput.value = toHexColor(mutedTextColor);

  const accentColorInput = document.getElementById('theme-accentColor');
  if (accentColorInput) accentColorInput.value = toHexColor(accentColor);

  const cardBgInput = document.getElementById('theme-cardBackground');
  if (cardBgInput) cardBgInput.value = toHexColor(cardBg);

  const cardOpacityInput = document.getElementById('theme-cardOpacity');
  if (cardOpacityInput) {
    cardOpacityInput.value = cardOpacity;
    const opacityValue = document.getElementById('theme-cardOpacity-value');
    if (opacityValue) opacityValue.textContent = cardOpacity;
  }

  const cardBorderColorInput = document.getElementById('theme-cardBorderColor');
  if (cardBorderColorInput) cardBorderColorInput.value = toHexColor(cardBorderColor);

  const cardBorderRadiusInput = document.getElementById('theme-cardBorderRadius');
  if (cardBorderRadiusInput) {
    cardBorderRadiusInput.value = cardBorderRadius;
    const radiusValue = document.getElementById('theme-cardBorderRadius-value');
    if (radiusValue) radiusValue.textContent = `${cardBorderRadius}px`;
  }

  // Show/hide controls based on bg type
  window.setBgType(bgType);

  // Clear background preview
  const bgPreview = document.getElementById('theme-background-preview');
  if (bgPreview) {
    bgPreview.style.display = 'none';
    bgPreview.innerHTML = '';
  }

  panel.style.display = 'block';
  customizationDirty = false;
  window.updatePreview();
};

/**
 * Close customization panel
 */
window.closeCustomization = function() {
  const panel = document.getElementById('theme-customization-panel');
  if (panel) panel.style.display = 'none';
  customizationDirty = false;
};

/**
 * Set background type visibility
 */
window.setBgType = function(type) {
  const colorControls = document.getElementById('bg-color-controls');
  const gradientControls = document.getElementById('bg-gradient-controls');
  const imageControls = document.getElementById('bg-image-controls');

  if (colorControls) colorControls.style.display = type === 'color' ? 'block' : 'none';
  if (gradientControls) gradientControls.style.display = type === 'gradient' ? 'block' : 'none';
  if (imageControls) imageControls.style.display = type === 'image' ? 'block' : 'none';

  window.updatePreview();
};

/**
 * Update live preview
 */
window.updatePreview = function() {
  const frame = document.getElementById('profile-frame');
  if (!frame) return;

  const bgType = document.querySelector('input[name="bg-type"]:checked')?.value || 'color';
  const bgColor = document.getElementById('theme-backgroundColor')?.value || '#fff7ec';
  const bgGradient = document.getElementById('theme-backgroundGradient')?.value || '';
  const bgPosition = document.getElementById('theme-backgroundPosition')?.value || 'center';
  const bgRepeat = document.getElementById('theme-backgroundRepeat')?.value || 'no-repeat';
  const bgSize = document.getElementById('theme-backgroundSize')?.value || 'cover';
  const textColor = document.getElementById('theme-textColor')?.value || '#2a2130';
  const mutedTextColor = document.getElementById('theme-mutedTextColor')?.value || '#6b6072';
  const accentColor = document.getElementById('theme-accentColor')?.value || '#0e6e6e';
  const cardBg = document.getElementById('theme-cardBackground')?.value || '#fff7ec';
  const hasBackground = bgType === 'image' || (bgType === 'gradient' && bgGradient);
  const defaultCardOpacity = hasBackground ? 0.8 : 0.95;
  const cardOpacity = parseFloat(document.getElementById('theme-cardOpacity')?.value || String(defaultCardOpacity));
  const effectiveCardOpacity = hasBackground ? Math.min(cardOpacity, 0.85) : cardOpacity;
  const cardBgRgba = toRgbaWithOpacity(cardBg, effectiveCardOpacity);
  const cardBorderColor = document.getElementById('theme-cardBorderColor')?.value || '#f0dfc8';
  const cardBorderRadius = parseInt(document.getElementById('theme-cardBorderRadius')?.value || '28', 10);

  const opacityValue = document.getElementById('theme-cardOpacity-value');
  if (opacityValue) opacityValue.textContent = cardOpacity.toFixed(2);

  const radiusValue = document.getElementById('theme-cardBorderRadius-value');
  if (radiusValue) radiusValue.textContent = `${cardBorderRadius}px`;

  let backgroundValue = bgColor;
  if (bgType === 'gradient' && bgGradient) {
    backgroundValue = bgGradient;
  }

  // Set CSS variables on the frame so all profile elements inherit them
  frame.style.setProperty('--theme-background', backgroundValue);
  frame.style.setProperty('--theme-card-background', cardBgRgba);
  frame.style.setProperty('--theme-card-opacity', effectiveCardOpacity);
  frame.style.setProperty('--theme-card-border-color', cardBorderColor);
  frame.style.setProperty('--theme-card-radius', `${cardBorderRadius}px`);
  frame.style.setProperty('--theme-text', textColor);
  frame.style.setProperty('--theme-text-secondary', mutedTextColor);
  frame.style.setProperty('--theme-accent', accentColor);

  // Apply background to the profile frame (the page), NOT the card
  frame.style.backgroundImage = '';
  frame.style.background = '';
  if (bgType === 'image') {
    const bgImage = currentProfile?.theme?.custom?.backgroundImage || currentProfile?.theme?.config?.backgroundImage || '';
    if (bgImage) {
      frame.style.backgroundImage = `url(${bgImage})`;
      frame.style.backgroundColor = bgColor;
      frame.style.backgroundPosition = bgPosition;
      frame.style.backgroundRepeat = bgRepeat;
      frame.style.backgroundSize = bgSize;
    } else {
      frame.style.background = backgroundValue;
    }
  } else {
    frame.style.background = backgroundValue;
  }

  customizationDirty = true;
};

/**
 * Handle background upload
 */
window.handleBackgroundUpload = async function(input) {
  const file = input.files[0];
  if (!file) return;

  const status = document.getElementById('theme-background-status');
  const preview = document.getElementById('theme-background-preview');

  if (!file.type.startsWith('image/')) {
    status.textContent = 'Invalid file type. Allowed: JPEG, PNG, WebP';
    status.className = 'upload-status error';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    status.textContent = 'File too large. Maximum size: 5MB';
    status.className = 'upload-status error';
    return;
  }

  status.textContent = 'Uploading...';
  status.className = 'upload-status';
  if (preview) preview.style.display = 'none';

  try {
    const result = await profileApi.uploadBackground(file);
    status.textContent = 'Background uploaded!';
    status.className = 'upload-status success';

    // Update currentProfile theme custom
    if (!currentProfile.theme) currentProfile.theme = { config: {}, custom: {} };
    if (!currentProfile.theme.custom) currentProfile.theme.custom = {};
    currentProfile.theme.custom.backgroundImage = result.background_url;

    if (preview) {
      preview.innerHTML = `<img src="${result.background_url}" alt="Background preview" style="max-width:100%;border-radius:0.5rem">`;
      preview.style.display = 'block';
    }

    window.updatePreview();
    // Automatically select Background Image mode after upload
    const imageRadio = document.querySelector('input[name="bg-type"][value="image"]');
    if (imageRadio) imageRadio.checked = true;
    window.setBgType('image');
  } catch (err) {
    status.textContent = err.message || 'Upload failed';
    status.className = 'upload-status error';
  }
};

/**
 * Save theme customization
 */
window.saveCustomization = async function() {
  const bgType = document.querySelector('input[name="bg-type"]:checked')?.value || 'color';
  const bgColor = document.getElementById('theme-backgroundColor')?.value || '#fff7ec';
  const bgGradient = document.getElementById('theme-backgroundGradient')?.value || '';
  const bgPosition = document.getElementById('theme-backgroundPosition')?.value || 'center';
  const bgRepeat = document.getElementById('theme-backgroundRepeat')?.value || 'no-repeat';
  const bgSize = document.getElementById('theme-backgroundSize')?.value || 'cover';
  const textColor = document.getElementById('theme-textColor')?.value || '#2a2130';
  const mutedTextColor = document.getElementById('theme-mutedTextColor')?.value || '#6b6072';
  const accentColor = document.getElementById('theme-accentColor')?.value || '#0e6e6e';
  const cardBg = document.getElementById('theme-cardBackground')?.value || '#fff7ec';
  const cardOpacity = parseFloat(document.getElementById('theme-cardOpacity')?.value || '0.95');
  const cardBorderColor = document.getElementById('theme-cardBorderColor')?.value || '#f0dfc8';
  const cardBorderRadius = parseInt(document.getElementById('theme-cardBorderRadius')?.value || '28', 10);

  const payload = {
    backgroundImage: bgType === 'image' ? (currentProfile?.theme?.custom?.backgroundImage || null) : null,
    backgroundGradient: bgType === 'gradient' ? bgGradient : null,
    backgroundColor: bgType === 'color' ? bgColor : null,
    backgroundPosition: bgPosition,
    backgroundRepeat: bgRepeat,
    backgroundSize: bgSize,
    textColor,
    mutedTextColor,
    accentColor,
    cardBackground: cardBg,
    cardOpacity,
    cardBorderColor,
    cardBorderRadius
  };

  // Remove nulls
  for (const key of Object.keys(payload)) {
    if (payload[key] === null || payload[key] === undefined) {
      delete payload[key];
    }
  }

  try {
    const updated = await profileApi.updateTheme(payload);
    currentProfile = updated;
    applyProfileBackground(updated);
    window.closeCustomization();
  } catch (err) {
    const status = document.getElementById('theme-background-status');
    if (status) {
      status.textContent = err.message || 'Failed to save theme';
      status.className = 'upload-status error';
    }
  }
};

/**
 * Reset theme customization to default
 */
window.resetCustomization = async function() {
  try {
    const payload = {
      backgroundImage: null,
      backgroundGradient: null,
      backgroundColor: null,
      backgroundPosition: null,
      backgroundRepeat: null,
      backgroundSize: null,
      textColor: null,
      mutedTextColor: null,
      accentColor: null,
      cardBackground: null,
      cardOpacity: null,
      cardBorderColor: null,
      cardBorderRadius: null
    };

    const updated = await profileApi.updateTheme(payload);
    currentProfile = updated;
    applyProfileBackground(updated);
    window.closeCustomization();
  } catch (err) {
    const status = document.getElementById('theme-background-status');
    if (status) {
      status.textContent = err.message || 'Failed to reset theme';
      status.className = 'upload-status error';
    }
  }
};

/**
 * Handle logout
 */
window.handleLogout = function() {
  authApi.logout();
  navigate('/login');
};

/**
 * Initialize profile page
 */
export function initProfilePage() {
  window.loadProfile();
}

/**
 * Upload photo
 */
window.uploadPhoto = async function() {
  const photoInput = document.getElementById('photo-input');
  const uploadBtn = document.getElementById('upload-btn');
  const status = document.getElementById('upload-status');

  const file = photoInput.files[0];
  if (!file) {
    status.textContent = 'No file selected';
    status.className = 'upload-status error';
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  status.textContent = 'Uploading...';
  status.className = 'upload-status';

  try {
    const result = await profileApi.uploadPhoto(file);
    status.textContent = 'Photo uploaded successfully!';
    status.className = 'upload-status success';

    const updatedProfile = await profileApi.getOwnProfile();
    setCurrentUserProfile(updatedProfile);
    currentProfile = updatedProfile;
    applyProfileBackground(updatedProfile);

    const displayName = updatedProfile.display_name || updatedProfile.username;
    const alias = updatedProfile.alias_enabled && updatedProfile.alias ? updatedProfile.alias : '';

    // Update PROFILE-04 profile photo in the profile module
    const profilePhotoLarge = document.getElementById('profile-photo-large');
    const profilePhotoInitials = document.getElementById('profile-photo-initials');
    if (updatedProfile.profile_photo_url) {
      if (profilePhotoLarge) {
        profilePhotoLarge.src = updatedProfile.profile_photo_url;
        profilePhotoLarge.alt = displayName;
        profilePhotoLarge.style.display = 'block';
      }
      if (profilePhotoInitials) profilePhotoInitials.style.display = 'none';
    } else {
      if (profilePhotoLarge) profilePhotoLarge.style.display = 'none';
      if (profilePhotoInitials) {
        profilePhotoInitials.style.display = 'block';
        profilePhotoInitials.textContent = (displayName || '?').charAt(0).toUpperCase();
      }
    }

    // Update sidebar/avatar references if they exist (for other pages)
    const sidebarImg = document.getElementById('sidebar-avatar-img');
    const sidebarInitials = document.getElementById('sidebar-avatar-initials');
    const sidebarName = document.getElementById('sidebar-display-name');
    const sidebarAlias = document.getElementById('sidebar-alias');

    if (sidebarImg) {
      if (updatedProfile.profile_photo_url) {
        sidebarImg.src = updatedProfile.profile_photo_url;
        sidebarImg.alt = displayName;
        sidebarImg.style.display = 'block';
      }
    }
    if (sidebarInitials) {
      sidebarInitials.textContent = (displayName || '?').charAt(0).toUpperCase();
      if (updatedProfile.profile_photo_url) {
        sidebarInitials.style.display = 'none';
      }
    }
    if (sidebarName) sidebarName.textContent = displayName;
    if (sidebarAlias) sidebarAlias.textContent = alias ? `@${alias}` : '';
  } catch (err) {
    status.textContent = err.message || 'Upload failed';
    status.className = 'upload-status error';
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload';
    photoInput.value = '';
  }
};
