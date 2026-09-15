/**
 * KomuniPH Lite - Profile UI
 */

import { profileApi, testimonialsApi, galleryApi, albumsApi, authApi, isAuthenticated, getCurrentUserProfile, setCurrentUserProfile } from './api.js';
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
 * Resolve a stored backgroundSize value to a real CSS background-size value.
 * 'stretch' isn't a CSS keyword — it means "fill the frame exactly, ignoring
 * aspect ratio", which maps to `100% 100%`. Everything else (cover/contain/
 * auto) is already a valid CSS value and passes through unchanged.
 */
function resolveBackgroundSizeCss(bgSize) {
  return bgSize === 'stretch' ? '100% 100%' : bgSize;
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
export function renderProfilePage(viewUsername = null) {
  // PROFILE-PHOTO-SPA-01: the signed-in owner's own profile must ALWAYS render
  // in own mode, even when the URL is #/profile/:username (the "Profile" link
  // on the gallery / album pages). Only other users' profiles get the public
  // view with the small circular avatar. This keeps the header photo identical
  // no matter which path led here (Home -> Profile, Gallery -> Back,
  // Album -> Back, refresh, Back/Forward).
  const isPublicView = !!viewUsername && !isOwnUsername(viewUsername);
  if (!isPublicView && !isAuthenticated()) {
    navigate('/login');
    return '';
  }

    return `
      <div class="profile-frame" id="profile-frame" data-view="${isPublicView ? 'public' : 'own'}">
        <div class="profile-background-layer" id="profile-background-layer" aria-hidden="true"></div>
        <div class="profile-content-frame">
      <!-- Header -->
      <header class="profile-header" id="profile-header">
        <div class="profile-header-inner">
          <h1 class="profile-brand">KomuniPH</h1>
          <p class="profile-tagline">Your personal space on KomuniPH</p>
        </div>
      </header>

       <!-- Navigation -->
       ${isPublicView && !isAuthenticated() ? '' : `<nav class="profile-nav" id="profile-nav">
         <a href="#/home" class="profile-nav-link">Home</a>
         <a href="#/profile" class="profile-nav-link profile-nav-active">My Profile ▼</a>
         <a href="#/connections" class="profile-nav-link">My Connections ▼</a>
         <a href="#/explore" class="profile-nav-link">Explore ▼</a>
         <a href="#/search" class="profile-nav-link">Search</a>
         <a href="#/messages" class="profile-nav-link">Messages</a>
         <a href="#/settings" class="profile-nav-link">Settings</a>
         <button class="profile-nav-link profile-nav-link-logout" onclick="window.handleLogout()">Log Out</button>
       </nav>`}

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
<div class="profile-module-body">
                 <div id="profile-photo-section">${isPublicView ? '' : `
                   <div class="profile-photo-wrapper" id="profile-photo-wrapper">
                     <img class="profile-photo-large" id="profile-photo-large"
                          src="" alt="Profile photo"
                          style="display:none">
                     <div class="profile-photo-large" id="profile-photo-initials"
                          style="display:none; background: var(--theme-accent, var(--kp-teal)); color: white;">
                       ?
                     </div>
                     <button class="profile-photo-camera-btn" id="profile-photo-camera-btn" title="Change profile picture" aria-label="Change profile picture">
                       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="12" r="4"></circle></svg>
                     </button>
                   </div>
                   <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
                   <div id="upload-status" class="upload-status"></div>
                 `}${isPublicView ? `
                   <div class="profile-photo-display" id="profile-photo-display"></div>
                 ` : ''}
                <div id="profile-view">
                  <h2 class="profile-name" id="profile-name"></h2>
                  <p class="profile-username" id="profile-username"></p>
                  <p class="profile-nickname" id="profile-nickname"></p>

                  <div class="profile-info-grid" id="profile-info-grid">
                    <!-- Identity fields will be populated by JS -->
                  </div>${isPublicView ? '' : `
                  <div class="profile-actions" id="profile-actions">
                    <button class="profile-action-btn" onclick="window.startEditProfile()">Edit Profile</button>
                    <button class="profile-action-btn" onclick="window.openCustomization()">Customize Profile</button>
                  </div>`}
                </div>${isPublicView ? '' : `
                <div id="profile-edit" style="display:none">
                  <!-- Edit form will be populated by startEditProfile() -->
                </div>`}
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
                    <span class="profile-info-label">Birthday:</span>
                  </div>
                  <span class="profile-info-value" id="profile-info-birthday"></span>
                  <br>
                 <div>
                   <span class="profile-info-label">About Me:</span>
                 </div>
                 <span class="profile-info-value" id="profile-info-bio"></span>
               </div>
             </div>
           </div>

            <!-- Testimonials Module -->
            <div class="profile-module" id="testimonials-module">
              <div class="profile-module-header">
                Testimonials
                <span></span>
              </div>
              <div class="profile-module-body" id="testimonials-body">
                <div id="testimonials-empty" class="testimonials-empty" style="display:none">
                  No testimonials yet.
                  <br>Be the first to leave one.
                </div>
                <div id="testimonials-list" class="testimonials-list">
                  <!-- Testimonials will appear here -->
                </div>
                <div id="testimonial-form-container" style="display:none">
                  <form id="testimonial-form" class="form" novalidate>
                    <div id="testimonial-error" class="error-banner" style="display:none"></div>
                    <div id="testimonial-success" class="success-banner" style="display:none"></div>
                    <div class="form-group">
                      <label class="form-label" for="testimonial-message">Your testimonial for <span id="testimonial-target-name"></span></label>
                      <textarea id="testimonial-message" rows="3" maxlength="1000" placeholder="Share your experience..."></textarea>
                      <div id="testimonial-char-count" class="char-count">0 / 1000</div>
                    </div>
                    <div class="edit-actions">
                      <button type="submit" class="btn btn-primary" id="testimonial-submit-btn">Submit Testimonial</button>
                    </div>
                  </form>
                </div>
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
              ${isPublicView ? '' : `
                <div class="photo-gallery-upload" id="photo-gallery-upload">
                  <input type="file" id="gallery-photo-input" accept="image/jpeg,image/png,image/webp" multiple style="display:none">
                  <button class="btn btn-primary btn-sm" onclick="document.getElementById('gallery-photo-input').click()">Upload Photos</button>
                  <div id="gallery-upload-queue" class="gallery-upload-queue" style="display:none"></div>
                  <div id="gallery-upload-status" class="upload-status"></div>
                </div>
              `}
              <div class="photo-gallery" id="photo-gallery">
                <div class="photo-gallery-empty" id="photo-gallery-empty">
                  No photos yet.
                </div>
                <div class="photo-gallery-grid" id="photo-gallery-grid" style="display:none"></div>
              </div>
              <!-- GALLERY-ROUTES-01: entry point to the dedicated gallery page.
                   Uses the hash router (navigate()) — never a server path. -->
              <div class="photo-gallery-preview-footer" id="photo-gallery-preview-footer">
                <button type="button" class="photo-gallery-view-all" id="photo-gallery-view-all"
                        ${isPublicView ? `onclick="window.openGalleryPage('${escapeHtmlAttr(viewUsername)}')"` : 'onclick="window.openGalleryPage()"'}>View All Photos &rarr;</button>
                <span class="photo-gallery-preview-meta" id="photo-gallery-preview-meta"></span>
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
                </p>
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
                  <option value="cover">Cover (crop to fill)</option>
                  <option value="contain">Contain (fit inside)</option>
                  <option value="stretch">Stretch (fill exactly)</option>
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
    </div>
  `;
}

/**
 * Apply theme background to the profile page frame.
 * Sets CSS variables and background-image on .profile-frame
 * so the user's background covers the entire profile page.
 */
// Default Gradient Slate theme — used when no custom background is set
const DEFAULT_BACKGROUND_GRADIENT = 'linear-gradient(135deg, #0f172a 0%, #334155 50%, #475569 100%)';

function applyProfileBackground(profile) {
  const frame = document.getElementById('profile-frame');
  if (!frame) return;
  const bgLayer = document.getElementById('profile-background-layer');

  const theme = profile?.theme && profile.theme.config ? profile.theme.config : {};
  const custom = profile?.theme && profile.theme.custom ? profile.theme.custom : {};

  const bgImage = custom.backgroundImage || theme.backgroundImage || '';
  const customGradient = custom.backgroundGradient || '';
  const themeGradient = theme.backgroundGradient || '';
  const customColor = custom.backgroundColor || '';
  const bgColor = theme.background || theme.backgroundColor || '#fff7ec';
  const bgPosition = custom.backgroundPosition || theme.backgroundPosition || 'center';
  const bgRepeat = custom.backgroundRepeat || theme.backgroundRepeat || 'no-repeat';
  const bgSize = custom.backgroundSize || theme.backgroundSize || 'cover';

  const cardBg = custom.cardBackground || theme.cardBackground || 'rgba(255, 247, 236, 0.95)';
  const hasImageBackground = !!bgImage;
  const hasCustomGradient = !!customGradient;
  const hasCustomColor = !!customColor;
  const hasThemeGradient = !!themeGradient;
  const hasBackground = hasImageBackground || hasCustomGradient || hasThemeGradient;
  const defaultCardOpacity = hasBackground ? 0.8 : 0.95;
  const cardOpacity = custom.cardOpacity != null ? custom.cardOpacity : defaultCardOpacity;
  const effectiveCardOpacity = hasBackground ? Math.min(cardOpacity, 0.85) : cardOpacity;
  const cardBgRgba = toRgbaWithOpacity(cardBg, effectiveCardOpacity);
  const cardBorderColor = custom.cardBorderColor || theme.border || '#f0dfc8';
  const cardBorderRadius = custom.cardBorderRadius || theme.cardRadius || '1.75rem';
  const cardBorderRadiusValue = typeof cardBorderRadius === 'number' ? `${cardBorderRadius}px` : cardBorderRadius;
  const cardShadow = theme.cardShadow || '0 20px 60px -20px rgba(42, 33, 48, 0.35)';
  const textColor = custom.textColor || theme.text || '#2a2130';
  const mutedTextColor = custom.mutedTextColor || theme.textSecondary || '#6b6072';
  const accentColor = custom.accentColor || theme.accent || '#0e6e6e';

  // Set CSS variables on the frame so all child elements inherit them
  frame.style.setProperty('--theme-background', bgColor);
  frame.style.setProperty('--theme-card-background', cardBgRgba);
  frame.style.setProperty('--theme-card-opacity', effectiveCardOpacity);
  frame.style.setProperty('--theme-card-border-color', cardBorderColor);
  frame.style.setProperty('--theme-card-radius', cardBorderRadiusValue);
  frame.style.setProperty('--theme-card-shadow', cardShadow);
  frame.style.setProperty('--theme-text', textColor);
  frame.style.setProperty('--theme-text-secondary', mutedTextColor);
  frame.style.setProperty('--theme-accent', accentColor);

  // Apply background to the fixed viewport layer, NOT the scrolling frame.
  // Priority: uploaded image > custom gradient > custom color > theme gradient > theme color
  if (bgLayer) {
    bgLayer.style.backgroundImage = '';
    bgLayer.style.background = '';
    if (bgImage) {
      bgLayer.style.backgroundImage = `url(${bgImage})`;
      bgLayer.style.backgroundColor = bgColor;
      bgLayer.style.backgroundPosition = bgPosition;
      bgLayer.style.backgroundRepeat = bgRepeat;
      bgLayer.style.backgroundSize = resolveBackgroundSizeCss(bgSize);
    } else if (hasCustomGradient) {
      bgLayer.style.background = customGradient;
    } else if (hasCustomColor) {
      bgLayer.style.background = customColor;
    } else if (hasThemeGradient) {
      bgLayer.style.background = themeGradient;
    } else {
      bgLayer.style.background = bgColor;
    }
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

    renderProfileView(profile);
    await loadAndRenderTestimonials(profile.username, false);
    await loadAndRenderGallery(profile.username, true);

  } catch (err) {
    console.error('[PROFILE] Load profile error:', err);
    const statusStrip = document.getElementById('profile-status-strip');
    if (statusStrip) {
      statusStrip.textContent = 'Failed to load profile: ' + (err.message || 'Unknown error');
      statusStrip.style.color = '#dc2626';
    }
  }
};

window.loadPublicProfile = async function(username) {
  try {
    const profile = await profileApi.getPublicProfile(username);
    currentProfile = profile;
    applyProfileBackground(profile);
    renderProfileView(profile);

    const formContainer = document.getElementById('testimonial-form-container');
    const testimonialForm = document.getElementById('testimonial-form');
    const targetName = document.getElementById('testimonial-target-name');

    if (isAuthenticated()) {
      // Authenticated visitor on another user's profile - show the form
      if (formContainer) {
        formContainer.style.display = 'block';
      }
      if (testimonialForm) {
        testimonialForm.style.display = 'block';
      }
      // Remove any existing login prompt
      const existingPrompt = formContainer?.querySelector('.testimonial-login-prompt');
      if (existingPrompt) existingPrompt.remove();
      if (targetName) {
        targetName.textContent = `@${profile.username}`;
      }
      await loadAndRenderTestimonials(profile.username, true);
      initTestimonialForm();
    } else {
      // Unauthenticated visitor - show login prompt, hide the form
      if (formContainer) {
        formContainer.style.display = 'block';
      }
      if (testimonialForm) {
        testimonialForm.style.display = 'none';
      }
      const loginPrompt = formContainer?.querySelector('.testimonial-login-prompt');
      if (!loginPrompt) {
        const prompt = document.createElement('div');
        prompt.className = 'testimonial-login-prompt';
        prompt.innerHTML = '<p style="color: var(--theme-text-secondary, #6b6072); font-size: 0.875rem; text-align: center; padding: 1rem;">Want to leave a testimonial?<br><a href="#/login" style="color: var(--theme-accent, var(--kp-teal)); font-weight: 600;">Log in</a> to write one.</p>';
        formContainer.appendChild(prompt);
      }
      await loadAndRenderTestimonials(profile.username, false);
    }

    await loadAndRenderGallery(profile.username, false);

  } catch (err) {
    console.error('[PROFILE] Load public profile error:', err);
    const statusStrip = document.getElementById('profile-status-strip');
    if (statusStrip) {
      statusStrip.textContent = 'Failed to load profile: ' + (err.message || 'Unknown error');
      statusStrip.style.color = '#dc2626';
    }
  }
};

async function loadAndRenderTestimonials(username, showForm) {
  try {
    const response = await testimonialsApi.getTestimonials(username);
    renderTestimonials(response.testimonials || []);

    if (showForm) {
      const formContainer = document.getElementById('testimonial-form-container');
      if (formContainer) formContainer.style.display = 'block';
    }
  } catch (err) {
    console.error('[TESTIMONIALS] Failed to load testimonials:', err);
    renderTestimonials([]);
  }
}

/**
 * Render the profile view (name, username, nickname, photo, personal info)
 * from the current profile data. Called by loadProfile() and after save.
 */
function renderProfileView(profile) {
  if (!profile) return;

  const firstName = profile.first_name || '';
  const lastName = profile.last_name || '';
  const middleName = profile.middle_name || '';
  const nickname = profile.nickname || '';
  const username = profile.username || '';
  const bio = profile.bio || '';
  const alias = profile.alias_enabled && profile.alias ? profile.alias : '';

  // PROFILE-04: Build the display name from real name fields, NOT username
  const nameDisplay = getProfileDisplayName(profile) || '';
  const nicknameDisplay = nickname ? `"${nickname}"` : '';

  // Update profile name display in the frame
  const nameEl = document.getElementById('profile-name');
  const usernameEl = document.getElementById('profile-username');
  const nicknameEl = document.getElementById('profile-nickname');

  if (nameEl) nameEl.textContent = nameDisplay;
  if (usernameEl) usernameEl.textContent = `@${username}`;
  if (nicknameEl) nicknameEl.textContent = nicknameDisplay;

  // Update personal info module
  const infoNameEl = document.getElementById('profile-info-name');
  const infoNicknameEl = document.getElementById('profile-info-nickname');
  const infoLocationEl = document.getElementById('profile-info-location');
  const infoBioEl = document.getElementById('profile-info-bio');

  if (infoNameEl) infoNameEl.textContent = nameDisplay;
  if (infoNicknameEl) infoNicknameEl.textContent = nickname || '';
   if (infoLocationEl) {
     const locationParts = [profile.country, profile.city, profile.barangay].filter(Boolean);
     infoLocationEl.textContent = locationParts.join(', ') || '';
   }
   const infoBirthdayEl = document.getElementById('profile-info-birthday');
   if (infoBirthdayEl) {
     infoBirthdayEl.textContent = profile.birthday || '';
   }
   if (infoBioEl) infoBioEl.textContent = bio || '';

  // Update profile photo (own profile)
  const profilePhotoLarge = document.getElementById('profile-photo-large');
  const profilePhotoInitials = document.getElementById('profile-photo-initials');
  if (profile.profile_photo_url) {
    if (profilePhotoLarge) {
      profilePhotoLarge.src = profile.profile_photo_url;
      profilePhotoLarge.alt = nameDisplay || username;
      profilePhotoLarge.style.display = 'block';
    }
    if (profilePhotoInitials) {
      profilePhotoInitials.style.display = 'none';
    }
  } else {
    if (profilePhotoLarge) profilePhotoLarge.style.display = 'none';
    if (profilePhotoInitials) {
      profilePhotoInitials.style.display = 'block';
      profilePhotoInitials.textContent = (nameDisplay || username || '?').charAt(0).toUpperCase();
    }
  }

  // Update public profile photo display
  const publicPhotoDisplay = document.getElementById('profile-photo-display');
  if (publicPhotoDisplay) {
    if (profile.profile_photo_url) {
      publicPhotoDisplay.innerHTML = `<img src="${escapeHtmlAttr(profile.profile_photo_url)}" alt="${escapeHtmlAttr(nameDisplay || username)}" class="profile-photo-public">`;
    } else {
      publicPhotoDisplay.innerHTML = `<div class="profile-photo-public-initials" style="background: var(--theme-accent, var(--kp-teal)); color: white;">${(nameDisplay || username || '?').charAt(0).toUpperCase()}</div>`;
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
      sidebarImg.alt = nameDisplay;
      sidebarImg.style.display = 'block';
    }
  }
  if (sidebarInitials) {
    sidebarInitials.textContent = (nameDisplay || '?').charAt(0).toUpperCase();
    if (profile.profile_photo_url) {
      sidebarInitials.style.display = 'none';
    }
  }
  if (sidebarName) sidebarName.textContent = nameDisplay;
  if (sidebarAlias) sidebarAlias.textContent = alias ? `@${alias}` : '';
}

/**
 * Enter edit mode
 */
window.startEditProfile = async function() {
  const view = document.getElementById('profile-view');
  const edit = document.getElementById('profile-edit');
  const error = document.getElementById('edit-profile-error');
  if (!view || !edit) return;

  if (error) {
    error.style.display = 'none';
    error.textContent = '';
  }

  const firstName = (currentProfile && currentProfile.first_name) || '';
  const middleName = (currentProfile && currentProfile.middle_name) || '';
  const lastName = (currentProfile && currentProfile.last_name) || '';
  const nickname = (currentProfile && currentProfile.nickname) || '';
  const aliasValue = (currentProfile && currentProfile.alias) || '';
  const bioValue = (currentProfile && currentProfile.bio) || '';
  const birthdayValue = (currentProfile && currentProfile.birthday) || '';
  const countryValue = (currentProfile && currentProfile.country) || '';
  const cityValue = (currentProfile && currentProfile.city) || '';
  const barangayValue = (currentProfile && currentProfile.barangay) || '';

  edit.innerHTML = `
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
      <label for="edit-bio">Bio</label>
      <textarea id="edit-bio" rows="3" maxlength="500">${escapeHtml(bioValue)}</textarea>
    </div>
    <div class="form-group">
      <label for="edit-birthday">Birthday</label>
      <input type="date" id="edit-birthday" value="${escapeHtml(birthdayValue)}">
    </div>
    <div class="form-group">
      <label for="edit-country">Country</label>
      <select id="edit-country" onchange="window.onCountryChange()">
        <option value="">Select a country</option>
      </select>
    </div>
    <div class="form-group">
      <label for="edit-city">City</label>
      <select id="edit-city" onchange="window.onCityChange()">
        <option value="">Select a city</option>
      </select>
    </div>
    <div class="form-group">
      <label for="edit-barangay">Barangay</label>
      <select id="edit-barangay">
        <option value="">Select a barangay</option>
      </select>
    </div>
    <div class="form-group">
      <label for="edit-alias">Alias</label>
      <input type="text" id="edit-alias" maxlength="50" value="${escapeHtml(aliasValue)}" placeholder="Optional">
    </div>
    <div id="edit-profile-error" class="error-banner" style="display:none"></div>
    <div class="edit-actions">
      <button class="btn btn-primary" id="save-profile-btn" onclick="window.saveProfile()">Save Changes</button>
      <button class="btn btn-secondary" id="cancel-profile-btn" onclick="window.cancelEditProfile()">Cancel</button>
    </div>
  `;

  view.style.display = 'none';
  edit.style.display = 'block';

  populateLocationDropdowns(countryValue, cityValue, barangayValue);
};

window.onCountryChange = function() {
  populateCityDropdown();
};

window.onCityChange = function() {
  populateBarangayDropdown();
};

function populateCityDropdown() {
  const country = document.getElementById('edit-country')?.value || '';
  const citySelect = document.getElementById('edit-city');
  const barangaySelect = document.getElementById('edit-barangay');
  if (!citySelect) return;

  citySelect.innerHTML = '<option value="">Select a city</option>';
  citySelect.disabled = !country;
  if (barangaySelect) {
    barangaySelect.innerHTML = '<option value="">Select a barangay</option>';
    barangaySelect.disabled = !country;
  }

  if (country && window.locationDataCache) {
    const cities = window.locationDataCache.cities[country] || [];
    cities.forEach(city => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = city;
      citySelect.appendChild(opt);
    });
  }
}

function populateBarangayDropdown() {
  const country = document.getElementById('edit-country')?.value || '';
  const city = document.getElementById('edit-city')?.value || '';
  const barangaySelect = document.getElementById('edit-barangay');
  if (!barangaySelect) return;

  barangaySelect.innerHTML = '<option value="">Select a barangay</option>';
  barangaySelect.disabled = !country || !city;

  if (country && city && window.locationDataCache) {
    const barangays = (window.locationDataCache.barangays[country] && window.locationDataCache.barangays[country][city]) || [];
    barangays.forEach(bg => {
      const opt = document.createElement('option');
      opt.value = bg;
      opt.textContent = bg;
      barangaySelect.appendChild(opt);
    });
  }
}

async function populateLocationDropdowns(selectedCountry, selectedCity, selectedBarangay) {
  try {
    const locationData = await profileApi.getLocations();
    window.locationDataCache = locationData;

    const countrySelect = document.getElementById('edit-country');
    const citySelect = document.getElementById('edit-city');
    const barangaySelect = document.getElementById('edit-barangay');

    countrySelect.innerHTML = '<option value="">Select a country</option>';
    if (locationData.countries && locationData.countries.length) {
      locationData.countries.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === selectedCountry) opt.selected = true;
        countrySelect.appendChild(opt);
      });
    }

    citySelect.innerHTML = '<option value="">Select a city</option>';
    citySelect.disabled = !selectedCountry;

    barangaySelect.innerHTML = '<option value="">Select a barangay</option>';
    barangaySelect.disabled = !selectedCountry || !selectedCity;

    if (selectedCountry) {
      const cities = locationData.cities[selectedCountry] || [];
      cities.forEach(city => {
        const opt = document.createElement('option');
        opt.value = city;
        opt.textContent = city;
        if (city === selectedCity) opt.selected = true;
        citySelect.appendChild(opt);
      });

      if (selectedCity) {
        const barangays = locationData.barangays[selectedCountry] && locationData.barangays[selectedCountry][selectedCity] || [];
        barangays.forEach(bg => {
          const opt = document.createElement('option');
          opt.value = bg;
          opt.textContent = bg;
          if (bg === selectedBarangay) opt.selected = true;
          barangaySelect.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.error('[PROFILE] Failed to load locations:', err);
  }
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
 * Build the profile display name from identity fields.
 * Falls back to username if no name fields are set.
 */
function getProfileDisplayName(profile) {
  if (!profile) return '';
  const firstName = profile.first_name || '';
  const middleName = profile.middle_name || '';
  const lastName = profile.last_name || '';
  const fullNameParts = [firstName, middleName, lastName].filter(Boolean);
  return fullNameParts.join(' ') || profile.username || '';
}

/**
 * Restore pre-edit values and leave edit mode (FEED-07)
 */
window.cancelEditProfile = function() {
  const view = document.getElementById('profile-view');
  const edit = document.getElementById('profile-edit');
  const error = document.getElementById('edit-profile-error');
  if (!view || !edit) return;

  const firstName = (currentProfile && currentProfile.first_name) || '';
  const middleName = (currentProfile && currentProfile.middle_name) || '';
  const lastName = (currentProfile && currentProfile.last_name) || '';
  const nickname = (currentProfile && currentProfile.nickname) || '';
  const aliasValue = (currentProfile && currentProfile.alias) || '';
  const bioValue = (currentProfile && currentProfile.bio) || '';
  const birthdayValue = (currentProfile && currentProfile.birthday) || '';
  const countryValue = (currentProfile && currentProfile.country) || '';
  const cityValue = (currentProfile && currentProfile.city) || '';
  const barangayValue = (currentProfile && currentProfile.barangay) || '';

  const firstNameInput = document.getElementById('edit-first-name');
  const middleNameInput = document.getElementById('edit-middle-name');
  const lastNameInput = document.getElementById('edit-last-name');
  const nicknameInput = document.getElementById('edit-nickname');
  const aliasInput = document.getElementById('edit-alias');
  const bioInput = document.getElementById('edit-bio');
  const birthdayInput = document.getElementById('edit-birthday');
  if (firstNameInput) firstNameInput.value = firstName;
  if (middleNameInput) middleNameInput.value = middleName;
  if (lastNameInput) lastNameInput.value = lastName;
  if (nicknameInput) nicknameInput.value = nickname;
  if (aliasInput) aliasInput.value = aliasValue;
  if (bioInput) bioInput.value = bioValue;
  if (birthdayInput) birthdayInput.value = birthdayValue;

  populateLocationDropdowns(countryValue, cityValue, barangayValue);

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

  const firstName = (document.getElementById('edit-first-name')?.value || '').trim();
  const middleName = (document.getElementById('edit-middle-name')?.value || '').trim();
  const lastName = (document.getElementById('edit-last-name')?.value || '').trim();
  const nickname = (document.getElementById('edit-nickname')?.value || '').trim();
  const alias = (document.getElementById('edit-alias')?.value || '').trim();
  const bio = (document.getElementById('edit-bio')?.value || '').trim();
  const birthday = (document.getElementById('edit-birthday')?.value || '').trim();
  const country = (document.getElementById('edit-country')?.value || '').trim();
  const city = (document.getElementById('edit-city')?.value || '').trim();
  const barangay = (document.getElementById('edit-barangay')?.value || '').trim();

  // Validate first_name (required)
  if (!firstName) {
    showEditError('First name is required');
    return;
  }
  if (firstName.length > 100) {
    showEditError('First name must be less than 100 characters');
    return;
  }

  // Validate last_name (required)
  if (!lastName) {
    showEditError('Last name is required');
    return;
  }
  if (lastName.length > 100) {
    showEditError('Last name must be less than 100 characters');
    return;
  }

  // Validate middle_name (optional, max 100)
  if (middleName.length > 100) {
    showEditError('Middle name must be less than 100 characters');
    return;
  }

  // Validate nickname (optional, max 50)
  if (nickname.length > 50) {
    showEditError('Nickname must be less than 50 characters');
    return;
  }

  // Validate alias (optional, max 50)
  if (alias.length > 50) {
    showEditError('Alias must be less than 50 characters');
    return;
  }

  if (bio.length > 500) {
    showEditError('Bio must be less than 500 characters');
    return;
  }

  if (birthday && !isValidDate(birthday)) {
    showEditError('Please enter a valid date');
    return;
  }

  if (saveBtn && saveBtn.disabled) return;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const updated = await profileApi.updateProfile({
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      nickname: nickname || null,
      alias: alias || null,
      bio: bio || null,
      birthday: birthday || null,
      country: country || null,
      city: city || null,
      barangay: barangay || null,
    });

    currentProfile = updated;
    applyProfileBackground(updated);

    // Refresh the profile view with updated values
    renderProfileView(updated);

    // Switch back to profile view
    const view = document.getElementById('profile-view');
    const edit = document.getElementById('profile-edit');
    if (view) view.style.display = 'block';
    if (edit) edit.style.display = 'none';
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

function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

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
  const bgLayer = document.getElementById('profile-background-layer');

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
  const themeGradient = currentProfile?.theme?.config?.backgroundGradient || '';
  const customTheme = currentProfile?.theme?.custom || {};
  const hasCustomBg = customTheme.backgroundColor || customTheme.backgroundGradient || customTheme.backgroundImage;
  const hasBackground = bgType === 'image' || (bgType === 'gradient' && bgGradient) || (!hasCustomBg && !!themeGradient);
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
  } else if (bgType === 'color' && !hasCustomBg && themeGradient) {
    backgroundValue = themeGradient;
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

  // Apply background to the fixed viewport layer, NOT the scrolling frame
  if (bgLayer) {
    bgLayer.style.backgroundImage = '';
    bgLayer.style.background = '';
    if (bgType === 'image') {
      const bgImage = currentProfile?.theme?.custom?.backgroundImage || currentProfile?.theme?.config?.backgroundImage || '';
      if (bgImage) {
        bgLayer.style.backgroundImage = `url(${bgImage})`;
        bgLayer.style.backgroundColor = bgColor;
        bgLayer.style.backgroundPosition = bgPosition;
        bgLayer.style.backgroundRepeat = bgRepeat;
        bgLayer.style.backgroundSize = resolveBackgroundSizeCss(bgSize);
      } else {
        bgLayer.style.background = backgroundValue;
      }
    } else {
      bgLayer.style.background = backgroundValue;
    }
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

  // Don't save backgroundColor when it matches the theme default — this keeps
  // the Gradient Slate default active for profiles that haven't explicitly set
  // a custom color
  const themeDefaultBg = currentProfile?.theme?.config?.background || '#fff7ec';
  const isDefaultColor = bgColor === themeDefaultBg || bgColor === '#fff7ec';

  const payload = {
    backgroundImage: bgType === 'image' ? (currentProfile?.theme?.custom?.backgroundImage || null) : null,
    backgroundGradient: bgType === 'gradient' ? bgGradient : null,
    backgroundColor: (bgType === 'color' && !isDefaultColor) ? bgColor : null,
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

function formatTestimonialDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function escapeHtmlAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTestimonialCard(testimonial) {
  const author = testimonial.author || {};
  const displayName = author.display_name || author.username || 'Anonymous';
  const authorUsername = author.username || '';
  const photoUrl = author.profile_photo_url;

  const avatarInitial = (displayName || authorUsername || '?').charAt(0).toUpperCase();

  let avatarHtml;
  if (photoUrl) {
    avatarHtml = `<img src="${escapeHtmlAttr(photoUrl)}" alt="${escapeHtmlAttr(displayName)}" class="testimonial-avatar">`;
  } else {
    avatarHtml = `<div class="testimonial-avatar-initials">${avatarInitial}</div>`;
  }

  const formattedDate = formatTestimonialDate(testimonial.created_at);
  const escapedMessage = escapeHtml(testimonial.message || '');

  return `
    <div class="testimonial-card" data-testimonial-id="${escapeHtmlAttr(testimonial.id)}">
      <div class="testimonial-avatar-container">
        ${avatarHtml}
      </div>
      <div class="testimonial-content">
        <div class="testimonial-message">${escapedMessage}</div>
        <div class="testimonial-author">
          <span class="testimonial-author-name">${escapeHtml(displayName)}</span>
          <span class="testimonial-author-handle">@${escapeHtml(authorUsername)}</span>
          <span class="testimonial-date">${formattedDate}</span>
        </div>
        ${testimonial.is_current_user_author ? `<button class="testimonial-delete-btn" onclick="window.deleteTestimonial('${escapeHtmlAttr(testimonial.id)}')">Delete</button>` : ''}
      </div>
    </div>
  `;
}

function renderTestimonials(testimonials) {
  const listEl = document.getElementById('testimonials-list');
  const emptyEl = document.getElementById('testimonials-empty');

  if (!listEl || !emptyEl) return;

  if (!testimonials || testimonials.length === 0) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.style.display = 'block';
  listEl.innerHTML = testimonials.map(renderTestimonialCard).join('');
}

window.deleteTestimonial = async function(testimonialId) {
  if (!confirm('Delete this testimonial?')) return;

  try {
    await testimonialsApi.deleteTestimonial(testimonialId);
    const card = document.querySelector(`.testimonial-card[data-testimonial-id="${CSS.escape(testimonialId)}"]`);
    if (card) card.remove();

    const listEl = document.getElementById('testimonials-list');
    const emptyEl = document.getElementById('testimonials-empty');
    if (listEl && listEl.children.length === 0) {
      listEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
    }
  } catch (err) {
    console.error('[TESTIMONIALS] Delete error:', err);
    alert(err.message || 'Failed to delete testimonial');
  }
};

window.initTestimonialForm = function() {
  const form = document.getElementById('testimonial-form');
  if (!form) return;

  const textarea = document.getElementById('testimonial-message');
  const charCount = document.getElementById('testimonial-char-count');
  const submitBtn = document.getElementById('testimonial-submit-btn');

  if (textarea) {
    textarea.addEventListener('input', function() {
      if (charCount) {
        charCount.textContent = `${this.value.length} / 1000`;
        charCount.className = 'char-count' + (this.value.length > 950 ? ' char-count-warning' : '');
      }
    });
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();

    const message = textarea ? textarea.value.trim() : '';
    const targetName = document.getElementById('testimonial-target-name');
    const targetUsername = targetName ? targetName.textContent.replace('@', '') : '';

    const errorMsg = document.getElementById('testimonial-error');
    const successMsg = document.getElementById('testimonial-success');

    if (errorMsg) {
      errorMsg.style.display = 'none';
      errorMsg.textContent = '';
    }
    if (successMsg) {
      successMsg.style.display = 'none';
      successMsg.textContent = '';
    }

    if (!message) {
      if (errorMsg) {
        errorMsg.textContent = 'Testimonial message is required';
        errorMsg.style.display = 'block';
      }
      return;
    }

    if (message.length > 1000) {
      if (errorMsg) {
        errorMsg.textContent = 'Testimonial must be 1000 characters or less';
        errorMsg.style.display = 'block';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    try {
      const result = await testimonialsApi.createTestimonial(
        currentProfile.username,
        message
      );

      if (successMsg) {
        successMsg.textContent = 'Testimonial submitted successfully!';
        successMsg.style.display = 'block';
      }

      if (textarea) textarea.value = '';
      if (charCount) charCount.textContent = '0 / 1000';

      await loadAndRenderTestimonials(currentProfile.username, true);
    } catch (err) {
      if (errorMsg) {
        errorMsg.textContent = err.message || 'Failed to submit testimonial';
        errorMsg.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Testimonial';
      }
    }
  });
};

/**
 * Initialize profile page
 */
export function initProfilePage() {
  const hash = window.location.hash.slice(1) || '/login';
  // GALLERY-ROUTES-01: only a bare /profile/:username is a profile page.
  // `(.+)` would also match /profile/:user/photos[/:albumId].
  const publicMatch = hash.match(/^\/profile\/([^/]+)$/);
  // PROFILE-PHOTO-SPA-01: when the username in the URL belongs to the signed-in
  // user, load through the authenticated endpoint so the page mounts the own
  // view (camera button, rectangular profile-photo-large) — identical to
  // #/profile. Genuine public views are unchanged.
  if (publicMatch && !isOwnUsername(safeDecode(publicMatch[1]))) {
    window.loadPublicProfile(safeDecode(publicMatch[1]));
  } else {
    window.loadProfile();
  }

  // Initialize camera button for profile photo
  initProfilePhotoCamera();
}

/**
 * Initialize profile photo camera button
 */
function initProfilePhotoCamera() {
  const cameraBtn = document.getElementById('profile-photo-camera-btn');
  const photoInput = document.getElementById('photo-input');
  
  if (cameraBtn && photoInput) {
    cameraBtn.addEventListener('click', () => {
      photoInput.click();
    });

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files[0];
      if (!file) return;

      const status = document.getElementById('upload-status');
      status.textContent = 'Uploading...';
      status.className = 'upload-status';

      try {
        const result = await profileApi.uploadPhoto(file);
        status.textContent = 'Photo uploaded successfully!';
        status.className = 'upload-status success';

        // Reload profile to get updated photo
        const updatedProfile = await profileApi.getOwnProfile();
        setCurrentUserProfile(updatedProfile);
        currentProfile = updatedProfile;
        applyProfileBackground(updatedProfile);

        const displayName = getProfileDisplayName(updatedProfile);
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

        // Update public photo display
        const publicPhotoDisplay = document.getElementById('profile-photo-display');
        if (publicPhotoDisplay) {
          if (updatedProfile.profile_photo_url) {
            publicPhotoDisplay.innerHTML = `<img src="${escapeHtmlAttr(updatedProfile.profile_photo_url)}" alt="${escapeHtmlAttr(displayName)}" class="profile-photo-public">`;
          } else {
            publicPhotoDisplay.innerHTML = `<div class="profile-photo-public-initials" style="background: var(--theme-accent, var(--kp-teal)); color: white;">${(displayName || '?').charAt(0).toUpperCase()}</div>`;
          }
        }
      } catch (err) {
        status.textContent = err.message || 'Upload failed';
        status.className = 'upload-status error';
      } finally {
        photoInput.value = '';
      }
    });
  }
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

    const displayName = getProfileDisplayName(updatedProfile);
    const alias = updatedProfile.alias_enabled && updatedProfile.alias ? updatedProfile.alias : '';
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

/**
 * Load and render photo gallery (sidebar preview on the profile page)
 */
async function loadAndRenderGallery(username, isOwnProfile) {
  try {
    let response;
    if (isOwnProfile) {
      response = await galleryApi.getOwnPhotos();
    } else {
      response = await galleryApi.getPhotos(username);
    }
    const photos = response.photos || [];
    // The profile page only shows a short preview; the lightbox still navigates
    // across the whole gallery, and "View All Photos" links to the full page.
    renderGallery(photos.slice(0, PROFILE_GALLERY_PREVIEW_LIMIT), isOwnProfile, photos);
    renderGalleryPreviewMeta(photos.length);
    initGalleryUpload();
  } catch (err) {
    console.error('[GALLERY] Failed to load gallery:', err);
    renderGallery([], isOwnProfile);
    renderGalleryPreviewMeta(0);
  }
}

/**
 * Update the "View All Photos" preview counter on the profile page
 */
function renderGalleryPreviewMeta(totalPhotos) {
  const metaEl = document.getElementById('photo-gallery-preview-meta');
  if (!metaEl) return;
  const total = totalPhotos || 0;
  metaEl.textContent = total > 0 ? `${total} photo${total === 1 ? '' : 's'}` : '';
}

/**
 * Render photo gallery grid
 *
 * @param {Array} photos - photos to render in the grid
 * @param {boolean} isOwnProfile - show owner-only controls (delete)
 * @param {Array} lightboxSource - full photo list used by the lightbox
 *   (defaults to the rendered photos when not supplied)
 */
function renderGallery(photos, isOwnProfile, lightboxSource = photos) {
  const gridEl = document.getElementById('photo-gallery-grid');
  const emptyEl = document.getElementById('photo-gallery-empty');
  const uploadEl = document.getElementById('photo-gallery-upload');

  if (!gridEl || !emptyEl) return;

  if (!photos || photos.length === 0) {
    gridEl.style.display = 'none';
    gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    if (uploadEl) uploadEl.style.display = isOwnProfile ? 'block' : 'none';
    return;
  }

  emptyEl.style.display = 'none';
  gridEl.style.display = 'grid';
  if (uploadEl) uploadEl.style.display = isOwnProfile ? 'block' : 'none';

  gridEl.innerHTML = photos.map(photo => renderGalleryItemHtml(photo, isOwnProfile)).join('');

  // Add click handlers for lightbox
  bindGalleryGridLightbox(gridEl, photos, lightboxSource);
}

/**
 * Render a single gallery grid item
 */
function renderGalleryItemHtml(photo, isOwnProfile) {
  return `
    <div class="photo-gallery-item" data-photo-id="${escapeHtmlAttr(photo.id)}">
      <img src="${escapeHtmlAttr(photo.thumbnail_url)}" alt="${escapeHtmlAttr(photo.caption || 'Gallery photo')}" class="photo-gallery-thumb" loading="lazy">
      ${isOwnProfile ? `
        <button class="photo-gallery-delete" onclick="window.deleteGalleryPhoto('${escapeHtmlAttr(photo.id)}')" title="Delete photo">&times;</button>
      ` : ''}
      ${photo.caption ? `<div class="photo-gallery-caption">${escapeHtml(photo.caption)}</div>` : ''}
    </div>
  `;
}

/**
 * Attach lightbox click handlers to a rendered gallery grid
 *
 * @param {HTMLElement} gridEl - rendered grid container
 * @param {Array} displayedPhotos - photos present in the grid (for index lookup)
 * @param {Array} lightboxSource - photo list the lightbox navigates through
 */
function bindGalleryGridLightbox(gridEl, displayedPhotos, lightboxSource = displayedPhotos) {
  gridEl.querySelectorAll('.photo-gallery-item').forEach((item, index) => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('photo-gallery-delete')) return;
      const startIndex = lightboxSource === displayedPhotos ? index : 0;
      openLightbox(lightboxSource, startIndex);
    });
  });
}

/**
 * Initialize gallery upload handler
 */
function initGalleryUpload() {
  const input = document.getElementById('gallery-photo-input');
  if (!input) return;

  // Remove existing listener if any
  input.replaceWith(input.cloneNode(true));
  const newInput = document.getElementById('gallery-photo-input');

  newInput.addEventListener('change', async function() {
    const files = Array.from(this.files);
    if (files.length === 0) return;

    const queueEl = document.getElementById('gallery-upload-queue');
    const status = document.getElementById('gallery-upload-status');
    const uploadBtn = document.querySelector('#photo-gallery-upload .btn');

    // Validate all files first
    const validFiles = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        status.textContent = `Invalid file type: ${file.name}. Allowed: JPEG, PNG, WebP`;
        status.className = 'upload-status error';
        this.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        status.textContent = `File too large: ${file.name}. Maximum size: 5MB`;
        status.className = 'upload-status error';
        this.value = '';
        return;
      }
      validFiles.push(file);
    }

    // Show upload queue
    if (queueEl) {
      queueEl.style.display = 'block';
      queueEl.innerHTML = validFiles.map((file, index) => `
        <div class="gallery-upload-item" data-index="${index}">
          <span class="gallery-upload-filename">${escapeHtml(file.name)}</span>
          <span class="gallery-upload-status">Pending</span>
        </div>
      `).join('');
    }

    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = `Uploading ${validFiles.length} photos...`;
    }
    status.textContent = `Uploading ${validFiles.length} photos...`;
    status.className = 'upload-status';

    // Upload each file sequentially
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const itemEl = queueEl?.querySelector(`.gallery-upload-item[data-index="${i}"]`);
      const statusEl = itemEl?.querySelector('.gallery-upload-status');

      if (statusEl) {
        statusEl.textContent = 'Uploading...';
        statusEl.className = 'gallery-upload-status uploading';
      }

      try {
        // On the album page uploads are assigned to that album; on the profile
        // and gallery pages they go to the general gallery (album_id = null).
        await galleryApi.uploadPhoto(file, getGalleryUploadAlbumId());
        successCount++;
        if (statusEl) {
          statusEl.textContent = '✓ Done';
          statusEl.className = 'gallery-upload-status success';
        }
      } catch (err) {
        failCount++;
        if (statusEl) {
          statusEl.textContent = `✗ ${err.message || 'Failed'}`;
          statusEl.className = 'gallery-upload-status error';
        }
      }

      // Update overall status
      status.textContent = `Uploaded ${successCount} of ${validFiles.length}...`;
    }

    // Final status
    if (failCount === 0) {
      status.textContent = `All ${successCount} photos uploaded successfully!`;
      status.className = 'upload-status success';
    } else {
      status.textContent = `${successCount} uploaded, ${failCount} failed.`;
      status.className = 'upload-status error';
    }

    // Reload whichever gallery view is currently mounted
    await refreshActiveGalleryView();

    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload Photos';
    }

    // Clear queue after a delay
    setTimeout(() => {
      if (queueEl) {
        queueEl.style.display = 'none';
        queueEl.innerHTML = '';
      }
    }, 3000);

    this.value = '';
  });
}

/**
 * Lightbox state
 */
let lightboxPhotos = [];
let lightboxIndex = 0;

/**
 * Open lightbox with photos array and starting index
 */
function openLightbox(photos, index) {
  lightboxPhotos = photos;
  lightboxIndex = index;

  // Create lightbox if not exists
  let lightbox = document.getElementById('gallery-lightbox');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'gallery-lightbox';
    lightbox.className = 'gallery-lightbox';
    lightbox.innerHTML = `
      <div class="gallery-lightbox-overlay" onclick="closeLightbox()"></div>
      <div class="gallery-lightbox-content">
        <button class="gallery-lightbox-close" onclick="closeLightbox()" aria-label="Close">&times;</button>
        <button class="gallery-lightbox-nav gallery-lightbox-prev" onclick="lightboxPrev()" aria-label="Previous">&#8249;</button>
        <button class="gallery-lightbox-nav gallery-lightbox-next" onclick="lightboxNext()" aria-label="Next">&#8250;</button>
        <img id="gallery-lightbox-image" src="" alt="">
        <div class="gallery-lightbox-caption" id="gallery-lightbox-caption"></div>
      </div>
    `;
    document.body.appendChild(lightbox);
  }

  updateLightboxImage();
  lightbox.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Add keyboard handlers
  document.addEventListener('keydown', handleLightboxKeydown);
}

/**
 * Close lightbox
 */
function closeLightbox() {
  const lightbox = document.getElementById('gallery-lightbox');
  if (lightbox) {
    lightbox.style.display = 'none';
  }
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleLightboxKeydown);
}

/**
 * Handle keyboard navigation in lightbox
 */
function handleLightboxKeydown(e) {
  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowLeft') {
    lightboxPrev();
  } else if (e.key === 'ArrowRight') {
    lightboxNext();
  }
}

/**
 * Show previous image in lightbox
 */
function lightboxPrev() {
  if (lightboxPhotos.length === 0) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
  updateLightboxImage();
}

/**
 * Show next image in lightbox
 */
function lightboxNext() {
  if (lightboxPhotos.length === 0) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
  updateLightboxImage();
}

/**
 * Update lightbox image and caption
 */
function updateLightboxImage() {
  if (lightboxPhotos.length === 0) return;
  const photo = lightboxPhotos[lightboxIndex];
  const img = document.getElementById('gallery-lightbox-image');
  const caption = document.getElementById('gallery-lightbox-caption');
  const prevBtn = document.querySelector('.gallery-lightbox-prev');
  const nextBtn = document.querySelector('.gallery-lightbox-next');

  if (img) {
    img.src = photo.image_url;
    img.alt = photo.caption || 'Gallery photo';
  }
  if (caption) {
    caption.textContent = photo.caption || '';
    caption.style.display = photo.caption ? 'block' : 'none';
  }
  // Hide nav buttons if only one photo
  if (prevBtn && nextBtn) {
    const showNav = lightboxPhotos.length > 1;
    prevBtn.style.display = showNav ? 'flex' : 'none';
    nextBtn.style.display = showNav ? 'flex' : 'none';
  }
}

/**
 * Delete gallery photo (owner only)
 */
window.deleteGalleryPhoto = async function(photoId) {
  if (!confirm('Delete this photo?')) return;

  try {
    await galleryApi.deletePhoto(photoId);
    // Reload whichever gallery view is currently mounted
    await refreshActiveGalleryView();
  } catch (err) {
    console.error('[GALLERY] Delete error:', err);
    alert(err.message || 'Failed to delete photo');
  }
};

// Expose lightbox functions globally
window.closeLightbox = closeLightbox;
window.lightboxPrev = lightboxPrev;
window.lightboxNext = lightboxNext;

/* =========================================================================
 * GALLERY-ROUTES-01: Dedicated Photo Gallery + Album pages
 *
 * This app uses hash routing (window.location.hash), so the gallery lives at:
 *   #/profile/:username/photos
 *   #/profile/:username/photos/:albumId
 *
 * Every navigation goes through navigate() / <a href="#/..."> so refresh,
 * Back and Forward keep working without any server-side SPA routes.
 * ========================================================================= */

const PROFILE_GALLERY_PREVIEW_LIMIT = 6;

/**
 * State shared by the dedicated gallery and album pages.
 */
const galleryRoutes = {
  page: null,          // 'gallery' | 'album' | null
  username: '',
  albumId: null,
  isOwnProfile: false,
  photos: [],
  albums: [],
  album: null,
};

/**
 * Decode a URL component without throwing on malformed input.
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

/**
 * Parse the current hash into gallery route params.
 */
function parseGalleryHash() {
  const hash = window.location.hash.slice(1) || '';

  const albumMatch = hash.match(/^\/profile\/([^/]+)\/photos\/([^/]+)$/);
  if (albumMatch) {
    return { page: 'album', username: safeDecode(albumMatch[1]), albumId: safeDecode(albumMatch[2]) };
  }

  const galleryMatch = hash.match(/^\/profile\/([^/]+)\/photos$/);
  if (galleryMatch) {
    return { page: 'gallery', username: safeDecode(galleryMatch[1]), albumId: null };
  }

  return { page: null, username: '', albumId: null };
}

/**
 * Is the given username the signed-in user?
 */
function isOwnUsername(username) {
  if (!isAuthenticated() || !username) return false;
  const cached = getCurrentUserProfile();
  if (!cached || !cached.username) return false;
  return String(cached.username).toLowerCase() === String(username).toLowerCase();
}

/**
 * Render the shared page shell for the gallery / album pages.
 * Reuses the profile frame so the user's background (Gradient Slate by default,
 * uploaded image when set) is applied exactly like on the profile page.
 */
function renderGalleryShell({ username, activeNav, tagline, stripText, moduleHtml }) {
  const ownProfile = isOwnUsername(username);

  return `
    <div class="profile-frame" id="profile-frame" data-view="${ownProfile ? 'own' : 'public'}">
      <div class="profile-background-layer" id="profile-background-layer" aria-hidden="true"></div>
      <div class="profile-content-frame">
        <header class="profile-header" id="profile-header">
          <div class="profile-header-inner">
            <h1 class="profile-brand">KomuniPH</h1>
            <p class="profile-tagline">${escapeHtml(tagline)}</p>
          </div>
        </header>

        <nav class="profile-nav" id="gallery-nav">
          ${ownProfile ? '<a href="#/home" class="profile-nav-link">Home</a>' : ''}
          <a href="#/profile/${escapeHtmlAttr(username)}" class="profile-nav-link">Profile</a>
          <a href="#/profile/${escapeHtmlAttr(username)}/photos" class="profile-nav-link${activeNav === 'gallery' ? ' profile-nav-active' : ''}">Photo Gallery</a>
          ${isAuthenticated()
            ? '<button class="profile-nav-link profile-nav-link-logout" onclick="window.handleLogout()">Log Out</button>'
            : '<a href="#/login" class="profile-nav-link">Log In</a>'}
        </nav>

        <div class="profile-status-strip" id="gallery-status-strip">${escapeHtml(stripText)}</div>

        <div class="gallery-content" id="gallery-content">
          ${moduleHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render one album card (used on the dedicated gallery page).
 */
function renderAlbumCardHtml(album, username) {
  const coverThumb = album.cover_photo_url || '';
  const count = album.photo_count || 0;

  return `
    <a class="gallery-album-card" href="#/profile/${escapeHtmlAttr(username)}/photos/${escapeHtmlAttr(album.id)}">
      <div class="gallery-album-cover">
        ${coverThumb
          ? `<img src="${escapeHtmlAttr(coverThumb)}" alt="${escapeHtmlAttr(album.name)}" loading="lazy">`
          : '<div class="gallery-album-cover-placeholder">No photos yet</div>'}
      </div>
      <div class="gallery-album-info">
        <div class="gallery-album-name">${escapeHtml(album.name)}</div>
        <div class="gallery-album-meta">${count} photo${count === 1 ? '' : 's'}</div>
      </div>
    </a>
  `;
}

/**
 * Render the dedicated Photo Gallery page for a username.
 * Public and read-only for visitors of another profile.
 *
 * @param {string} username
 * @returns {string} HTML string
 */
export function renderGalleryPage(username) {
  const profileUsername = username || '';
  // Reset shared state for this navigation.
  galleryRoutes.page = 'gallery';
  galleryRoutes.username = profileUsername;
  galleryRoutes.albumId = null;
  galleryRoutes.isOwnProfile = isOwnUsername(profileUsername);
  galleryRoutes.photos = [];
  galleryRoutes.albums = [];
  galleryRoutes.album = null;

  return renderGalleryShell({
    username: profileUsername,
    activeNav: 'gallery',
    tagline: `Photo Gallery — @${profileUsername}`,
    stripText: 'Loading albums...',
    moduleHtml: `
      <section class="profile-module">
        <div class="profile-module-header">
          <span>Photo Gallery</span>
          <span id="gallery-album-total"></span>
        </div>
        <div class="profile-module-body">
          ${galleryRoutes.isOwnProfile ? renderGalleryUploadModule() : ''}
          <div class="gallery-albums" id="gallery-albums-grid">
            <div class="photo-gallery-empty">Loading albums...</div>
          </div>
        </div>
      </section>
    `,
  });
}

/**
 * Shared owner-only upload toolbar used by the gallery and album pages.
 * Uses the same element ids as the profile sidebar so the existing
 * initGalleryUpload() multi-upload flow can be reused unchanged.
 */
function renderGalleryUploadModule() {
  return `
    <div class="photo-gallery-upload" id="photo-gallery-upload">
      <input type="file" id="gallery-photo-input" accept="image/jpeg,image/png,image/webp" multiple style="display:none">
      <button class="btn btn-primary btn-sm" type="button" onclick="document.getElementById('gallery-photo-input').click()">Upload Photos</button>
      <div id="gallery-upload-queue" class="gallery-upload-queue" style="display:none"></div>
      <div id="gallery-upload-status" class="upload-status"></div>
    </div>
  `;
}

/**
 * Album id used as the upload target for the currently mounted gallery view.
 * Returns null on the profile page / gallery page (general gallery upload).
 */
function getGalleryUploadAlbumId() {
  return galleryRoutes.page === 'album' ? galleryRoutes.albumId : null;
}

/**
 * Reload whichever gallery view is currently mounted.
 * Used after a successful upload or delete.
 */
async function refreshActiveGalleryView() {
  if (galleryRoutes.page === 'gallery') {
    await refreshGalleryPage();
  } else if (galleryRoutes.page === 'album') {
    await refreshAlbumPage();
  } else if (currentProfile) {
    await loadAndRenderGallery(currentProfile.username, true);
  }
}

/**
 * Initialise the dedicated Photo Gallery page after it has been mounted.
 * Loads albums + photos, renders the Profile Pictures album first and then
 * every normal album, and wires up the lightbox / upload / delete behaviour.
 *
 * @param {string} username
 */
export async function initGalleryPage(username) {
  const params = parseGalleryHash();
  const profileUsername = username || params.username || galleryRoutes.username;

  try {
    const [albumResponse, photos] = await Promise.all([
      albumsApi.getAlbums(profileUsername),
      fetchGalleryPhotos(profileUsername),
    ]);

    galleryRoutes.albums = albumResponse.albums || [];
    galleryRoutes.photos = photos;
    galleryRoutes.isOwnProfile = galleryRoutes.isOwnProfile || !!albumResponse.is_own_profile;
  } catch (err) {
    console.error('[GALLERY] Failed to load gallery page:', err);
    setGalleryStatus(`Failed to load gallery: ${err.message || 'Unknown error'}`, true);
    const gridEl = document.getElementById('gallery-albums-grid');
    if (gridEl) {
      gridEl.innerHTML = '<div class="photo-gallery-empty">Could not load albums.</div>';
    }
    return;
  }

  // Owner-only multi-upload (reuses the profile sidebar upload flow)
  if (galleryRoutes.isOwnProfile) initGalleryUpload();

  renderGalleryAlbums();
  applyGalleryBackground(profileUsername);
}

/**
 * Render the album page for one album of a profile.
 * Photos shown are ONLY the ones belonging to the requested album.
 *
 * @param {string} username
 * @param {string} albumId
 * @returns {string} HTML string
 */
export function renderAlbumPage(username, albumId) {
  const profileUsername = username || '';

  galleryRoutes.page = 'album';
  galleryRoutes.username = profileUsername;
  galleryRoutes.albumId = albumId || null;
  galleryRoutes.isOwnProfile = isOwnUsername(profileUsername);
  galleryRoutes.photos = [];
  galleryRoutes.albums = [];
  galleryRoutes.album = null;

  const isOwner = galleryRoutes.isOwnProfile;

  return renderGalleryShell({
    username: profileUsername,
    activeNav: 'gallery',
    tagline: `Album — @${profileUsername}`,
    stripText: 'Loading album...',
    moduleHtml: `
      <section class="profile-module" id="album-module">
        <div class="profile-module-header">
          <span class="gallery-back-link">
            <a href="#/profile/${escapeHtmlAttr(profileUsername)}/photos" class="gallery-back-to-gallery">&larr; Back to Gallery</a>
          </span>
          <span class="gallery-album-owner">${isOwner ? 'Your album' : `@${escapeHtml(profileUsername)}`}</span>
        </div>
        <div class="profile-module-body">
          <div class="album-header" id="album-header">
            <div class="album-cover" id="album-cover"></div>
            <div class="album-header-text">
              <h2 class="album-title" id="album-title">Loading album...</h2>
              <div class="album-meta" id="album-meta"></div>
            </div>
          </div>

          ${isOwner ? renderGalleryUploadModule() : ''}

          <div class="photo-gallery" id="album-photo-gallery">
            <div class="photo-gallery-empty" id="album-photos-empty">Loading photos...</div>
            <div class="photo-gallery-grid" id="album-photos-grid" style="display:none"></div>
          </div>
        </div>
      </section>
    `,
  });
}

/**
 * Initialise the album page: load the album + its photos and show ONLY those.
 *
 * @param {string} username
 * @param {string} albumId
 */
export async function initAlbumPage(username, albumId) {
  const params = parseGalleryHash();
  const profileUsername = username || params.username || galleryRoutes.username;
  const targetAlbumId = albumId || params.albumId || galleryRoutes.albumId;

  if (!targetAlbumId) {
    setGalleryStatus('Album not found.', true);
    renderAlbumPhotos([], false);
    return;
  }

  galleryRoutes.albumId = targetAlbumId;

  try {
    // GALLERY-ROUTES-01: GET /api/profiles/:username/albums/:albumId returns the
    // album plus ONLY its own photos, and is public read-only, so the same call
    // serves the owner and any visitor.
    const albumResponse = await albumsApi.getAlbum(profileUsername, targetAlbumId);

    galleryRoutes.album = albumResponse.album || null;
    galleryRoutes.photos = sortPhotosByNewest(albumResponse.photos || []);
  } catch (err) {
    console.error('[GALLERY] Failed to load album:', err);
    setGalleryStatus(`Failed to load album: ${err.message || 'Unknown error'}`, true);
    renderAlbumPhotos([], false);
    applyGalleryBackground(profileUsername);
    return;
  }

  renderAlbumHeader(profileUsername);
  renderAlbumPhotos(galleryRoutes.photos, galleryRoutes.isOwnProfile);
  if (galleryRoutes.isOwnProfile) initGalleryUpload();
  applyGalleryBackground(profileUsername);
}

/**
 * Refresh the mounted album page (after upload / delete).
 */
async function refreshAlbumPage() {
  if (galleryRoutes.page !== 'album') return;
  await initAlbumPage(galleryRoutes.username, galleryRoutes.albumId);
}

/**
 * Sort photos newest first (mirrors the API ordering).
 */
function sortPhotosByNewest(photos) {
  return (photos || []).slice().sort((a, b) => {
    const aTime = Date.parse(a.created_at || '') || 0;
    const bTime = Date.parse(b.created_at || '') || 0;
    return bTime - aTime;
  });
}

/**
 * Render the album cover, title and photo count.
 */
function renderAlbumHeader(username) {
  const album = galleryRoutes.album;
  const photos = galleryRoutes.photos || [];
  const titleEl = document.getElementById('album-title');
  const metaEl = document.getElementById('album-meta');
  const coverEl = document.getElementById('album-cover');

  const albumName = album ? album.name : 'Album';
  const count = photos.length;

  if (titleEl) titleEl.textContent = albumName;
  if (metaEl) metaEl.textContent = `${count} photo${count === 1 ? '' : 's'} · @${username}`;
  if (coverEl) {
    const coverThumb = album && album.cover_photo_url;
    coverEl.innerHTML = coverThumb
      ? `<img src="${escapeHtmlAttr(coverThumb)}" alt="${escapeHtmlAttr(albumName)}">`
      : '<div class="gallery-album-cover-placeholder">No photos yet</div>';
  }

  setGalleryStatus(`Viewing album "${albumName}" — ${count} photo${count === 1 ? '' : 's'}.`);
}

/**
 * Render ONLY the photos of the current album into the album grid.
 */
function renderAlbumPhotos(photos, isOwnProfile) {
  const gridEl = document.getElementById('album-photos-grid');
  const emptyEl = document.getElementById('album-photos-empty');
  if (!gridEl || !emptyEl) return;

  if (!photos || photos.length === 0) {
    gridEl.style.display = 'none';
    gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = isOwnProfile
      ? 'No photos in this album yet. Use Upload Photos to add some.'
      : 'No photos in this album yet.';
    return;
  }

  emptyEl.style.display = 'none';
  gridEl.style.display = 'grid';
  gridEl.innerHTML = photos.map(photo => renderGalleryItemHtml(photo, isOwnProfile)).join('');

  // The lightbox navigates through this album's photos only.
  bindGalleryGridLightbox(gridEl, photos, photos);
}

/**
 * Refresh the mounted gallery page (after upload / delete).
 */
async function refreshGalleryPage() {
  if (galleryRoutes.page !== 'gallery') return;
  try {
    const [albumResponse, photos] = await Promise.all([
      albumsApi.getAlbums(galleryRoutes.username),
      fetchGalleryPhotos(galleryRoutes.username),
    ]);
    galleryRoutes.albums = albumResponse.albums || [];
    galleryRoutes.photos = photos;
  } catch (err) {
    console.error('[GALLERY] Refresh failed:', err);
  }
  renderGalleryAlbums();
}

/**
 * Fetch gallery photos for a username (public endpoint).
 */
async function fetchGalleryPhotos(username) {
  const response = await galleryApi.getPhotos(username);
  return response.photos || [];
}

/**
 * Render every album card — Profile Pictures first, then normal albums.
 * The API already orders them that way; the sort here keeps that guarantee
 * even if the ordering ever changes server-side.
 */
function renderGalleryAlbums() {
  const gridEl = document.getElementById('gallery-albums-grid');
  if (!gridEl) return;

  const username = galleryRoutes.username;
  const albums = (galleryRoutes.albums || []).slice().sort((a, b) => {
    if (a.is_profile_pictures && !b.is_profile_pictures) return -1;
    if (!a.is_profile_pictures && b.is_profile_pictures) return 1;
    return 0;
  });

  const totalEl = document.getElementById('gallery-album-total');
  const totalPhotos = albums.reduce((sum, album) => sum + (album.photo_count || 0), 0);
  if (totalEl) {
    totalEl.textContent = `${albums.length} album${albums.length === 1 ? '' : 's'} · ${totalPhotos} photo${totalPhotos === 1 ? '' : 's'}`;
  }

  if (albums.length === 0) {
    gridEl.innerHTML = `
      <div class="photo-gallery-empty">
        No albums to show yet.${galleryRoutes.isOwnProfile ? ' Upload photos to fill your gallery.' : ''}
      </div>
    `;
    setGalleryStatus(galleryRoutes.isOwnProfile
      ? 'Your gallery is empty.'
      : `@${username} has no photos yet.`);
    return;
  }

  gridEl.innerHTML = albums.map(album => renderAlbumCardHtml(album, username)).join('');

  const photoTotal = (galleryRoutes.photos || []).length;
  setGalleryStatus(`@${username} · ${photoTotal} photo${photoTotal === 1 ? '' : 's'} in ${albums.length} album${albums.length === 1 ? '' : 's'}`);
}

/**
 * Update the status strip on the gallery / album pages.
 */
function setGalleryStatus(message, isError = false) {
  const strip = document.getElementById('gallery-status-strip');
  if (!strip) return;
  strip.textContent = message || '';
  strip.style.color = isError ? '#dc2626' : '';
}

/**
 * Apply the profile's theme background to the gallery / album pages.
 */
async function applyGalleryBackground(username) {
  if (!username) return;
  try {
    const profile = await profileApi.getPublicProfile(username);
    applyProfileBackground(profile);
  } catch (err) {
    // Cosmetic only — never break the page over the background.
    console.warn('[GALLERY] Could not load profile background:', err.message || err);
  }
}

/**
 * Open an album from the gallery page using hash navigation.
 */
function openAlbumFromGallery(albumId) {
  if (!albumId) return;
  window.navigate(`/profile/${encodeURIComponent(galleryRoutes.username)}/photos/${encodeURIComponent(albumId)}`);
}

/**
 * Hash-navigation entry point for "View All Photos".
 * Called from the profile preview with no argument (own gallery) or with a
 * username (public gallery).
 */
window.openGalleryPage = function(username) {
  const target = username || (getCurrentUserProfile() || {}).username || '';
  if (!target) {
    console.warn('[GALLERY] Cannot open the gallery without a username');
    return;
  }
  window.navigate(`/profile/${encodeURIComponent(target)}/photos`);
};
