/**
 * KomuniPH Lite - Profile UI
 */

import { profileApi, testimonialsApi, galleryApi, albumsApi, authApi, isAuthenticated, getCurrentUserProfile, setCurrentUserProfile } from './api.js';
import { navigate } from './app.js';
import { renderGalleryItemHtml, bindGalleryGridLightbox, isOwnUsername, safeDecode, renderAlbumCardsHtml } from './gallery.js'; // PHASE-3 GALLERY-SPLIT-01
import { applyProfileDesign } from './profileDesign.js'; // CREATOR-01A

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
 * Shared profile avatar presentation.
 *
 * Every profile photo in the app (public profile, editor, full-page preview,
 * initials fallback) must go through this helper so the avatar keeps ONE
 * consistent shape: a square box (aspect-ratio 1/1 + object-fit cover) shown
 * as a circle. `variant` picks the sizing context; the shape never changes.
 */
function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Shared profile avatar presentation.
 *
 * Every profile photo in the app (public profile, editor, full-page preview,
 * initials fallback) must go through this helper so the avatar keeps ONE
 * consistent shape: a square box (aspect-ratio 1/1 + object-fit cover) shown
 * as a circle. `variant` picks the sizing context; the shape never changes.
 */
function avatarImg(photoUrl, alt, variant = 'avatar-public') {
  return `<img src="${escapeHtmlAttr(photoUrl)}" alt="${escapeHtmlAttr(alt)}" class="profile-avatar-img ${variant}" style="aspect-ratio:1 / 1">`;
}

function avatarInitials(nameDisplay, username, variant = 'avatar-public') {
  return `<div class="profile-avatar-initials ${variant}" style="aspect-ratio:1 / 1;background: var(--theme-accent, var(--kp-teal)); color: white;">${escapeHtml((nameDisplay || username || '?').charAt(0).toUpperCase())}</div>`;
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
export function renderProfilePage(viewUsername = null, { preview = false } = {}) {
  // PROFILE-PHOTO-SPA-01: the signed-in owner's own profile must ALWAYS render
  // in own mode, even when the URL is #/profile/:username (the "Profile" link
  // on the gallery / album pages). Only other users' profiles get the public
  // view with the small circular avatar. This keeps the header photo identical
  // no matter which path led here (Home -> Profile, Gallery -> Back,
  // Album -> Back, refresh, Back/Forward).
  const isPublicView = preview || (!!viewUsername && !isOwnUsername(viewUsername));
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
       ${preview || (isPublicView && !isAuthenticated()) ? '' : `<nav class="profile-nav" id="profile-nav">
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
                  <div class="profile-header-row">
                    <div class="profile-header-photo-column">
                      <div class="profile-header-photo">
<div id="profile-photo-section">${isPublicView ? '' : `
  <div class="profile-photo-wrapper" id="profile-photo-wrapper">
    <img class="profile-photo-large" id="profile-photo-large"
         src="" alt="Profile photo"
         style="display:none">
    <div class="profile-photo-large" id="profile-photo-initials"
         style="display:none; background: var(--theme-accent, var(--kp-teal)); color: white;">
      ?
    </div>
    <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
    <button class="profile-photo-camera-btn" id="profile-photo-camera-btn" title="Change profile picture" aria-label="Change profile picture">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="12" r="4"></circle></svg>
    </button>
  </div>
`}${isPublicView ? `
                          <div class="profile-photo-display" id="profile-photo-display"></div>
` : ''}
                       </div>
                     </div>
                       <div id="profile-view" class="profile-header-identity">
                        <h2 class="profile-name" id="profile-name"></h2>
                        <p class="profile-nickname" id="profile-nickname"></p>
                        <p id="profile-alias"></p>
                      </div>
                    </div>
                    <div class="profile-header-bio" id="profile-header-bio">
                      <div class="profile-bio-box" id="profile-bio-box">
                        <div class="profile-bio-text" id="profile-bio-text"></div>
                      </div>
                    </div>
                  </div>${isPublicView ? '' : `
                   <div class="profile-actions" id="profile-actions">
                     <a class="profile-action-btn" href="#/profile/edit">Edit Profile</a>
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
               <div class="personal-info-section">
                 <h4 class="personal-info-section-title">Education</h4>
                 <div class="personal-info-grid">
                   <div class="personal-info-item">
                     <span class="personal-info-label">School</span>
                     <span class="personal-info-value" id="personal-info-school"></span>
                   </div>
                   <div class="personal-info-item">
                     <span class="personal-info-label">Education / Course</span>
                     <span class="personal-info-value" id="personal-info-education"></span>
                   </div>
                 </div>
               </div>

               <div class="personal-info-section">
                 <h4 class="personal-info-section-title">Work</h4>
                 <div class="personal-info-grid">
                   <div class="personal-info-item">
                     <span class="personal-info-label">Occupation</span>
                     <span class="personal-info-value" id="personal-info-work"></span>
                   </div>
                   <div class="personal-info-item">
                     <span class="personal-info-label">Company</span>
                     <span class="personal-info-value" id="personal-info-company"></span>
                   </div>
                 </div>
               </div>

               <div class="personal-info-section">
                 <h4 class="personal-info-section-title">Location</h4>
                 <div class="personal-info-grid">
                   <div class="personal-info-item">
                     <span class="personal-info-label">Current City</span>
                     <span class="personal-info-value" id="personal-info-city"></span>
                   </div>
                   <div class="personal-info-item">
                     <span class="personal-info-label">Hometown</span>
                     <span class="personal-info-value" id="personal-info-hometown"></span>
                   </div>
                 </div>
                 <div class="personal-info-location-full">
                   <span class="personal-info-label">Full Location</span>
                   <span class="personal-info-value" id="personal-info-location"></span>
                 </div>
               </div>

<div class="personal-info-section">
                  <h4 class="personal-info-section-title">Personal</h4>
                  <div class="personal-info-interests">
                    <span class="personal-info-label">Interests</span>
                    <div class="interests-tags" id="personal-info-interests"></div>
                  </div>
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
                <div class="photo-gallery-grid" id="photo-gallery-grid" style="display:none"></div>
              </div>

              <!-- ALBUMS-UI-01: compact album cards -->
              <div class="gallery-section-subheader" id="profile-albums-header">
                <span>Albums</span>
              </div>
              <div class="gallery-albums" id="profile-albums-grid">
                <div class="photo-gallery-empty">Loading albums...</div>
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

          <!-- Community module: PROFILE-COMMUNITY-01 lists the profile owner's
               joined communities (filled by loadAndRenderProfileCommunities). -->
          <div class="sidebar-module" id="community-module">
            <div class="sidebar-module-header">
              Communities
            </div>
            <div class="sidebar-module-body" id="community-body">
              <div class="profile-communities" id="profile-communities">
                <p class="profile-communities-state" id="profile-communities-state">Loading communities…</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <footer class="profile-footer" id="profile-footer">
        ~ Welcome to my KomuniPH space ~
      </footer>


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

export function applyProfileBackground(profile) {
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
  const cardBorderRadius = custom.cardBorderRadius ?? theme.cardRadius ?? '1.75rem';
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
 * CREATOR-01A: apply a profile's published design layout, then fold any
 * design-level theme overrides into the existing theme pipeline. Design
 * overrides ride on the same custom-config path the editor writes, so there is
 * exactly one theme mechanism. No design -> default rendering, no re-theme.
 */
function applyProfileDesignAndTheme(profile) {
  applyProfileDesign(profile);
  const designTheme = profile && profile.design && profile.design.theme;
  if (designTheme && typeof designTheme === 'object' && Object.keys(designTheme).length > 0) {
    applyProfileBackground({
      ...profile,
      theme: { ...(profile.theme || {}), custom: { ...(profile.theme?.custom || {}), ...designTheme } },
    });
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
    await loadAndRenderProfileCommunities(profile.username);
    applyProfileDesignAndTheme(profile);

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
    await loadAndRenderProfileCommunities(profile.username);
    applyProfileDesignAndTheme(profile);

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
 * PROFILE-COMMUNITY-01: small visual indicator for each community scope.
 * Only the community type is used — no internal membership data.
 */
const PROFILE_COMMUNITY_TYPES = {
  nationwide: { icon: '🇵🇭', label: 'Nationwide' },
  city: { icon: '🏙️', label: 'City' },
  barangay: { icon: '📍', label: 'Barangay' },
};

/**
 * Load and render the profile owner's joined communities in the sidebar
 * Community card. Failures never break the rest of the profile page and never
 * surface raw API errors.
 *
 * @param {string} username profile owner (never the signed-in viewer)
 */
async function loadAndRenderProfileCommunities(username) {
  const container = document.getElementById('profile-communities');
  if (!container) return;

  try {
    const data = await profileApi.getProfileCommunities(username);
    renderProfileCommunities(container, data.communities || []);
  } catch (err) {
    console.error('[PROFILE] Failed to load communities:', err);
    container.innerHTML = '<p class="profile-communities-state">Communities aren\u2019t available right now.</p>';
  }
}

/**
 * Render joined communities as compact, clickable rows that open the existing
 * community detail route (#/community/:id).
 */
function renderProfileCommunities(container, communities) {
  if (!communities.length) {
    container.innerHTML = '<p class="profile-communities-state">No communities yet.</p>';
    return;
  }

  container.innerHTML = communities.map(community => {
    const meta = PROFILE_COMMUNITY_TYPES[community.type] || { icon: '🏘️', label: '' };
    return `<a class="profile-community-row" href="#/community/${escapeHtmlAttr(community.id)}">
      <span class="profile-community-icon" aria-hidden="true">${meta.icon}</span>
      <span class="profile-community-name">${escapeHtml(community.name)}</span>
      ${meta.label ? `<span class="profile-community-type">${meta.label}</span>` : ''}
    </a>`;
  }).join('');
}

/**
 * Render the profile view (name, username, nickname, photo, personal info)
 * from the current profile data. Called by loadProfile() and after save.
 */
export function renderProfileView(profile) {
  if (!profile) return;

  const firstName = profile.first_name || '';
  const lastName = profile.last_name || '';
  const middleName = profile.middle_name || '';
  const nickname = profile.nickname || '';
  const username = profile.username || '';
  const bio = profile.bio || '';

  // PROFILE-04: Build the display name from real name fields, NOT username
  const nameDisplay = getProfileDisplayName(profile) || '';
  const nicknameDisplay = nickname || '';

  // Update profile name display in the frame
  const nameEl = document.getElementById('profile-name');
  const nicknameEl = document.getElementById('profile-nickname');

  if (nameEl) nameEl.textContent = nameDisplay;
  if (nicknameEl) nicknameEl.textContent = nicknameDisplay;

  // Update bio in the profile header (right side)
  const headerBioEl = document.getElementById('profile-bio-text');
  const bioBoxEl = document.getElementById('profile-bio-box');
  if (headerBioEl) headerBioEl.textContent = bio || '';
  if (bioBoxEl) {
    if (bio) {
      bioBoxEl.classList.remove('profile-bio-empty');
    } else {
      bioBoxEl.classList.add('profile-bio-empty');
      headerBioEl.textContent = 'No bio added yet.';
    }
  }

  // Update personal info module
  const infoSchoolEl = document.getElementById('personal-info-school');
  const infoEducationEl = document.getElementById('personal-info-education');
  const infoWorkEl = document.getElementById('personal-info-work');
  const infoCompanyEl = document.getElementById('personal-info-company');
  const infoCityEl = document.getElementById('personal-info-city');
  const infoHometownEl = document.getElementById('personal-info-hometown');
  const infoLocationEl = document.getElementById('personal-info-location');
  const infoInterestsEl = document.getElementById('personal-info-interests');
  const infoBioEl = document.getElementById('personal-info-bio');

  if (infoSchoolEl) infoSchoolEl.textContent = profile.school || '';
  if (infoEducationEl) infoEducationEl.textContent = profile.education || '';
  if (infoWorkEl) infoWorkEl.textContent = profile.work || '';
  if (infoCompanyEl) infoCompanyEl.textContent = profile.company || '';
  if (infoCityEl) infoCityEl.textContent = profile.city || '';
  if (infoHometownEl) infoHometownEl.textContent = profile.hometown || '';
  
  if (infoLocationEl) {
    const locationParts = [profile.country, profile.city, profile.barangay].filter(Boolean);
    infoLocationEl.textContent = locationParts.join(', ') || '';
  }

  if (infoInterestsEl) {
    if (profile.interests) {
      const interestTags = profile.interests.split(',').map(i => i.trim()).filter(Boolean);
      if (interestTags.length > 0) {
        infoInterestsEl.innerHTML = interestTags.map(tag => 
          `<span class="interest-tag">${escapeHtml(tag)}</span>`
        ).join('');
      } else {
        infoInterestsEl.textContent = '';
      }
    } else {
      infoInterestsEl.textContent = '';
    }
  }

  if (infoBioEl) infoBioEl.textContent = profile.bio || '';

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
      profilePhotoInitials.style.display = 'flex';
      profilePhotoInitials.textContent = (nameDisplay || username || '?').charAt(0).toUpperCase();
    }
  }

  // Update public profile photo display
  const publicPhotoDisplay = document.getElementById('profile-photo-display');
  if (publicPhotoDisplay) {
    if (profile.profile_photo_url) {
      publicPhotoDisplay.innerHTML = `<img src="${escapeHtmlAttr(profile.profile_photo_url)}" alt="${escapeHtmlAttr(nameDisplay || username)}" class="profile-photo-public">`;
    } else {
      publicPhotoDisplay.innerHTML = `<div class="profile-photo-public-initials" style="background: var(--theme-accent, var(--kp-teal)); color: white;">${escapeHtml((nameDisplay || username || '?').charAt(0).toUpperCase())}</div>`;
    }
  }

  // Update sidebar/avatar references if they exist (for other pages)
  const sidebarImg = document.getElementById('sidebar-avatar-img');
  const sidebarInitials = document.getElementById('sidebar-avatar-initials');
  const sidebarName = document.getElementById('sidebar-display-name');

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
  initProfilePhotoUpload();
}

/**
 * Initialize profile photo upload for own profile
 */
export function initProfilePhotoUpload() {
  const cameraBtn = document.getElementById('profile-photo-camera-btn');
  const fileInput = document.getElementById('profile-photo-input');
  
  if (!cameraBtn || !fileInput) return;

  cameraBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    // Validate file
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Please choose a JPEG, PNG or WebP image.');
      fileInput.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be 5MB or smaller.');
      fileInput.value = '';
      return;
    }

    // Show loading state
    cameraBtn.style.opacity = '0.5';
    cameraBtn.title = 'Uploading...';

    try {
      const result = await profileApi.uploadPhoto(file);
      
      // Update current profile data
      if (currentProfile) {
        currentProfile.profile_photo_url = result.profile_photo_url;
      }
      
      // Refresh profile view to show new photo
      renderProfileView(currentProfile);
      
      // Show success
      cameraBtn.title = 'Profile photo updated successfully';
      setTimeout(() => {
        cameraBtn.title = 'Change profile picture';
      }, 3000);
    } catch (error) {
      console.error('Profile photo upload failed:', error);
      alert(error.message || 'Failed to upload profile photo. Please try again.');
    } finally {
      cameraBtn.style.opacity = '1';
      fileInput.value = '';
    }
  });
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
   const bioValue = (currentProfile && currentProfile.bio) || '';
   const birthdayValue = (currentProfile && currentProfile.birthday) || '';
   const countryValue = (currentProfile && currentProfile.country) || '';
   const cityValue = (currentProfile && currentProfile.city) || '';
   const barangayValue = (currentProfile && currentProfile.barangay) || '';
   const schoolValue = (currentProfile && currentProfile.school) || '';
   const educationValue = (currentProfile && currentProfile.education) || '';
   const workValue = (currentProfile && currentProfile.work) || '';
   const companyValue = (currentProfile && currentProfile.company) || '';
   const hometownValue = (currentProfile && currentProfile.hometown) || '';
   const interestsValue = (currentProfile && currentProfile.interests) || '';
   const realNameValue = (currentProfile && currentProfile.real_name) || '';

   edit.innerHTML = `
     <fieldset class="form-section">
       <legend>Identity</legend>
       <div class="form-row">
         <div class="form-group">
           <label for="edit-first-name">First Name (private) *</label>
           <input type="text" id="edit-first-name" maxlength="100" value="${escapeHtml(firstName)}" placeholder="Enter your first name">
         </div>
         <div class="form-group">
           <label for="edit-middle-name">Middle Name (private)</label>
           <input type="text" id="edit-middle-name" maxlength="100" value="${escapeHtml(middleName)}" placeholder="Enter your middle name (optional)">
         </div>
       </div>
       <div class="form-row">
         <div class="form-group">
           <label for="edit-last-name">Last Name (private) *</label>
           <input type="text" id="edit-last-name" maxlength="100" value="${escapeHtml(lastName)}" placeholder="Enter your last name">
         </div>
         <div class="form-group">
           <label for="edit-display-name">Display Name *</label>
           <input type="text" id="edit-display-name" maxlength="100" value="${escapeHtml(currentProfile?.display_name || '')}" placeholder="Your display identity">
         </div>
       </div>
       <div class="form-group">
         <label for="edit-real-name">Real Name (legal name)</label>
         <input type="text" id="edit-real-name" maxlength="100" value="${escapeHtml(realNameValue)}" placeholder="Your legal name">
       </div>
       <div class="form-group">
         <label for="edit-birthday">Birthday (visibility in Privacy)</label>
         <input type="date" id="edit-birthday" value="${escapeHtml(birthdayValue)}">
       </div>
     </fieldset>

    <fieldset class="form-section">
      <legend>Education</legend>
      <div class="form-group">
        <label for="edit-school">School</label>
        <input type="text" id="edit-school" maxlength="100" value="${escapeHtml(schoolValue)}" placeholder="e.g., University of Santo Tomas">
      </div>
      <div class="form-group">
        <label for="edit-education">Education / Course</label>
        <input type="text" id="edit-education" maxlength="100" value="${escapeHtml(educationValue)}" placeholder="e.g., BS Information Technology">
      </div>
    </fieldset>

    <fieldset class="form-section">
      <legend>Work</legend>
      <div class="form-row">
        <div class="form-group">
          <label for="edit-work">Occupation</label>
          <input type="text" id="edit-work" maxlength="100" value="${escapeHtml(workValue)}" placeholder="e.g., Software Developer">
        </div>
        <div class="form-group">
          <label for="edit-company">Company</label>
          <input type="text" id="edit-company" maxlength="100" value="${escapeHtml(companyValue)}" placeholder="e.g., Example Company">
        </div>
      </div>
    </fieldset>

    <fieldset class="form-section">
      <legend>Location</legend>
      <div class="form-row">
        <div class="form-group">
          <label for="edit-country">Country</label>
          <select id="edit-country" onchange="window.onCountryChange()">
            <option value="">Select a country</option>
          </select>
        </div>
        <div class="form-group">
          <label for="edit-city">Current City</label>
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
      </div>
      <div class="form-group">
        <label for="edit-hometown">Hometown</label>
        <input type="text" id="edit-hometown" maxlength="100" value="${escapeHtml(hometownValue)}" placeholder="e.g., Batangas">
      </div>
    </fieldset>

    <fieldset class="form-section">
      <legend>Personal</legend>
      <div class="form-group">
        <label for="edit-interests">Interests</label>
        <input type="text" id="edit-interests" maxlength="200" value="${escapeHtml(interestsValue)}" placeholder="e.g., music, gaming, photography, basketball">
        <p class="form-hint">Separate interests with commas</p>
      </div>
    </fieldset>

    <div class="form-group">
      <label for="edit-bio">Bio</label>
      <textarea id="edit-bio" rows="4" maxlength="500" placeholder="Tell people a little about yourself…">${escapeHtml(bioValue)}</textarea>
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

  // Live preview for display name
  const displayNameInput = document.getElementById('edit-display-name');
  if (displayNameInput) {
    displayNameInput.addEventListener('input', () => {
      if (currentProfile) {
        const previewProfile = { ...currentProfile, display_name: displayNameInput.value };
        renderProfileView(previewProfile);
      }
    });
  }
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
export function getProfileDisplayName(profile) {
  if (!profile) return '';
  // Public identity never falls back to private/legal name fields.
  return profile.display_name || profile.username || '';
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
   const aliasValue = (currentProfile && currentProfile.alias) || '';
   const bioValue = (currentProfile && currentProfile.bio) || '';
   const birthdayValue = (currentProfile && currentProfile.birthday) || '';
   const countryValue = (currentProfile && currentProfile.country) || '';
   const cityValue = (currentProfile && currentProfile.city) || '';
   const barangayValue = (currentProfile && currentProfile.barangay) || '';
   const schoolValue = (currentProfile && currentProfile.school) || '';
   const educationValue = (currentProfile && currentProfile.education) || '';
   const workValue = (currentProfile && currentProfile.work) || '';
   const companyValue = (currentProfile && currentProfile.company) || '';
   const hometownValue = (currentProfile && currentProfile.hometown) || '';
   const interestsValue = (currentProfile && currentProfile.interests) || '';
   const realNameValue = (currentProfile && currentProfile.real_name) || '';

   const firstNameInput = document.getElementById('edit-first-name');
  const middleNameInput = document.getElementById('edit-middle-name');
  const lastNameInput = document.getElementById('edit-last-name');
  const schoolInput = document.getElementById('edit-school');
  const educationInput = document.getElementById('edit-education');
  const workInput = document.getElementById('edit-work');
  const companyInput = document.getElementById('edit-company');
  const hometownInput = document.getElementById('edit-hometown');
  const interestsInput = document.getElementById('edit-interests');
  const bioInput = document.getElementById('edit-bio');
  const birthdayInput = document.getElementById('edit-birthday');
  const realNameInput = document.getElementById('edit-real-name');
  if (firstNameInput) firstNameInput.value = firstName;
  if (middleNameInput) middleNameInput.value = middleName;
  if (lastNameInput) lastNameInput.value = lastName;
  if (schoolInput) schoolInput.value = schoolValue;
  if (educationInput) educationInput.value = educationValue;
  if (workInput) workInput.value = workValue;
  if (companyInput) companyInput.value = companyValue;
  if (hometownInput) hometownInput.value = hometownValue;
  if (interestsInput) interestsInput.value = interestsValue;
  if (bioInput) bioInput.value = bioValue;
  if (birthdayInput) birthdayInput.value = birthdayValue;
  if (realNameInput) realNameInput.value = realNameValue;

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
   const bio = (document.getElementById('edit-bio')?.value || '').trim();
   const birthday = (document.getElementById('edit-birthday')?.value || '').trim();
   const country = (document.getElementById('edit-country')?.value || '').trim();
   const city = (document.getElementById('edit-city')?.value || '').trim();
   const barangay = (document.getElementById('edit-barangay')?.value || '').trim();
   const school = (document.getElementById('edit-school')?.value || '').trim();
   const education = (document.getElementById('edit-education')?.value || '').trim();
   const work = (document.getElementById('edit-work')?.value || '').trim();
   const company = (document.getElementById('edit-company')?.value || '').trim();
   const hometown = (document.getElementById('edit-hometown')?.value || '').trim();
   const interests = (document.getElementById('edit-interests')?.value || '').trim();
   const realName = (document.getElementById('edit-real-name')?.value || '').trim();

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

  if (bio.length > 500) {
    showEditError('Bio must be less than 500 characters');
    return;
  }

  if (birthday && !isValidDate(birthday)) {
    showEditError('Please enter a valid date');
    return;
  }

  // Validate new fields (optional, max lengths)
  if (school.length > 100) {
    showEditError('School must be less than 100 characters');
    return;
  }
  if (education.length > 100) {
    showEditError('Education must be less than 100 characters');
    return;
  }
  if (work.length > 100) {
    showEditError('Work must be less than 100 characters');
    return;
  }
  if (company.length > 100) {
    showEditError('Company must be less than 100 characters');
    return;
  }
  if (hometown.length > 100) {
    showEditError('Hometown must be less than 100 characters');
    return;
  }
  if (interests.length > 200) {
    showEditError('Interests must be less than 200 characters');
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
      display_name: document.getElementById('edit-display-name').value.trim(),
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      bio: bio || null,
      real_name: realName || null,
      birthday: birthday || null,
      country: country || null,
      city: city || null,
      barangay: barangay || null,
      school: school || null,
      education: education || null,
      work: work || null,
      company: company || null,
      hometown: hometown || null,
      interests: interests || null,
    });

    currentProfile = updated;
    setCurrentUserProfile(updated);
    document.getElementById('profile-editor')?.dispatchEvent(new CustomEvent('profile-saved', { detail: updated }));
    applyProfileBackground(updated);

    // Refresh the profile view with updated values
    renderProfileView(updated);

    // Keep the dedicated workspace open after saving.
    const view = document.getElementById('profile-view');
    const edit = document.getElementById('profile-edit');
    if (view) view.style.display = 'block';
    if (edit) edit.style.display = document.getElementById('profile-editor') ? 'block' : 'none';
    return updated;
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
  const bgType = custom.backgroundImage ? 'image' : custom.backgroundGradient ? 'gradient' : custom.backgroundColor ? 'color' : 'default';
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
  const baseRadius = String(theme.cardRadius || '1.75rem');
  const cardBorderRadius = custom.cardBorderRadius ?? (parseFloat(baseRadius) * (baseRadius.endsWith('rem') ? 16 : 1));

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
    const image = custom.backgroundImage || '';
    bgPreview.style.display = image ? 'block' : 'none';
    bgPreview.innerHTML = image ? '<img src="' + escapeHtmlAttr(image) + '" alt="Current background">' : '';
  }

  panel.style.display = 'block';
  customizationDirty = false;
  applyProfileBackground(currentProfile);
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
  if (!document.getElementById('profile-editor')) return;
  const custom = getThemeDraft();
  document.getElementById('theme-cardOpacity-value').textContent = custom.cardOpacity.toFixed(2);
  document.getElementById('theme-cardBorderRadius-value').textContent = custom.cardBorderRadius + 'px';
  applyProfileBackground({ ...currentProfile, theme: { ...currentProfile.theme, custom } });
  customizationDirty = true;
};

/**
 * Handle background upload
 */

/**
 * Save theme customization
 */
export function getThemeDraft() {
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
    backgroundGradient: bgType === 'gradient' ? (bgGradient || null) : null,
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

  return payload;
}

/**
 * Reset theme customization to default
 */

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


}

/**
 * Initialize profile photo camera button
 */

/**
 * Load and render photo gallery (sidebar preview on the profile page)
 */
export async function loadAndRenderGallery(username, isOwnProfile) {
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
  } catch (err) {
    console.error('[GALLERY] Failed to load gallery:', err);
    renderGallery([], isOwnProfile);
    renderGalleryPreviewMeta(0);
  }

  // ALBUMS-UI-01: the compact Albums section under the preview grid.
  await loadAndRenderAlbums(username, isOwnProfile);
}

/**
 * Load and render the profile page's Albums section (compact cards).
 * The owner also gets the Create Album form, which refreshes this section.
 *
 * @param {string} username
 * @param {boolean} isOwnProfile
 */
async function loadAndRenderAlbums(username, isOwnProfile) {
  const gridEl = document.getElementById('profile-albums-grid');
  if (!gridEl) return;

  try {
    const response = isOwnProfile
      ? await albumsApi.getOwnAlbums()
      : await albumsApi.getAlbums(username);
    const albums = response.albums || [];

    gridEl.innerHTML = renderAlbumCardsHtml(albums, username);
  } catch (err) {
    console.error('[ALBUMS] Failed to load albums:', err);
    gridEl.innerHTML = '<div class="photo-gallery-empty">Could not load albums.</div>';
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
 * Lightbox state
 */
let lightboxPhotos = [];
let lightboxIndex = 0;








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
 * Apply the profile's theme background to the gallery / album pages.
 */
export async function applyGalleryBackground(username) {
  if (!username) return;
  try {
    const profile = await profileApi.getPublicProfile(username);
    applyProfileBackground(profile);
  } catch (err) {
    // Cosmetic only — never break the page over the background.
    console.warn('[GALLERY] Could not load profile background:', err.message || err);
  }
}



/** Existing customization controls, mounted only in the editor. */
export function renderThemeControls() {
  return `      <!-- Theme customization panel -->
      <div id="theme-customization-panel" class="theme-panel" style="display:none">
        <div class="theme-panel-header">
          <h2>Customize Profile</h2>

        </div>

        <div class="theme-panel-body">
          <div class="theme-section">
            <h3>Background</h3>
            <div class="theme-radio-group">
              <label class="theme-radio"><input type="radio" name="bg-type" value="default" onchange="window.setBgType('default')"><span>Default Slate</span></label>
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
              <label class="theme-label" for="theme-background-input">Upload New Background</label>
              <p>Background uploads save immediately. Save Changes to apply positioning and card styles.</p>
              <input type="file" id="theme-background-input" accept="image/jpeg,image/png,image/webp">
              <div id="theme-background-status" class="upload-status"></div>
              <div id="theme-background-preview" class="theme-bg-preview" style="display:none"></div>
              <button type="button" id="editor-remove-background" class="btn btn-secondary">Remove Background</button>
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
          <button class="btn btn-secondary" id="editor-reset-theme">Reset to Default</button>
          <button class="btn btn-secondary" id="editor-cancel-theme">Cancel</button>
          <button class="btn btn-primary" id="editor-save-theme">Save Changes</button>
        </div>
      </div>`;
}

/** Reuse the public modules on demand; no edit/upload handlers in preview. */
export async function loadProfilePreviewContent(username) {
  const [testimonials, gallery, albums] = await Promise.all([
    testimonialsApi.getTestimonials(username), galleryApi.getPhotos(username), albumsApi.getAlbums(username)
  ]);
  renderTestimonials((testimonials.testimonials || []).map(item => ({ ...item, is_current_user_author: false })));
  const photos = gallery.photos || [];
  renderGallery(photos.slice(0, PROFILE_GALLERY_PREVIEW_LIMIT), false, photos);
  renderGalleryPreviewMeta(photos.length);
  const grid = document.getElementById('profile-albums-grid');
  if (grid) grid.innerHTML = renderAlbumCardsHtml(albums.albums || [], username);
  await loadAndRenderProfileCommunities(username);
}

export function setEditorProfile(profile) {
  currentProfile = profile;
  setCurrentUserProfile(profile);
}
