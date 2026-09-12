/**
 * KomuniPH Lite - Profile UI
 */

import { profileApi, isAuthenticated, getCurrentUserProfile, setCurrentUserProfile } from './api.js';
import { navigate } from './app.js';

let currentProfile = null;
let customizationDirty = false;

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
    <div class="profile-page" id="profile-page">
      <header class="home-header">
        <h1>Your Profile</h1>
        <a href="#/home" class="nav-link">Back to Home</a>
      </header>

      <div id="profile-loading" class="loading">
        <div class="spinner"></div>
        <p class="loading-text">Loading your profile...</p>
      </div>

      <div id="profile-content" style="display:none"></div>

      <div id="profile-error" class="error-state" style="display:none">
        <p class="error-message"></p>
        <button class="btn btn-secondary" onclick="window.loadProfile()">Retry</button>
      </div>

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
 * Load profile
 */
window.loadProfile = async function() {
  const loading = document.getElementById('profile-loading');
  const content = document.getElementById('profile-content');
  const error = document.getElementById('profile-error');
  const panel = document.getElementById('theme-customization-panel');

  loading.style.display = 'block';
  content.style.display = 'none';
  error.style.display = 'none';
  if (panel) panel.style.display = 'none';

  try {
    const profile = await profileApi.getOwnProfile();
    currentProfile = profile;
    content.innerHTML = renderProfileContent(profile);
    setupPhotoInput();
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load profile';
    error.style.display = 'block';
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

  const theme = profile.theme && profile.theme.config ? profile.theme.config : {};
  const bgImage = theme.backgroundImage || '';
  const bgGradient = theme.backgroundGradient || '';
  const bgColor = theme.background || theme.backgroundColor || '#fff7ec';
  const bgPosition = theme.backgroundPosition || 'center';
  const bgRepeat = theme.backgroundRepeat || 'no-repeat';
  const bgSize = theme.backgroundSize || 'cover';
  const cardBg = theme.cardBackground || 'rgba(255, 247, 236, 0.95)';
  const cardOpacity = theme.cardOpacity != null ? theme.cardOpacity : 0.95;
  const cardBorderColor = theme.cardBorderColor || theme.border || '#f0dfc8';
  const cardBorderRadius = theme.cardBorderRadius || theme.cardRadius || '1.75rem';
  const cardShadow = theme.cardShadow || '0 20px 60px -20px rgba(42, 33, 48, 0.35)';
  const textColor = theme.textColor || theme.text || '#2a2130';
  const mutedTextColor = theme.mutedTextColor || theme.textSecondary || '#6b6072';
  const accentColor = theme.accentColor || theme.accent || '#0e6e6e';

  const themeStyle = [
    `--theme-background: ${bgColor}`,
    `--theme-card-background: ${cardBg}`,
    `--theme-card-opacity: ${cardOpacity}`,
    `--theme-card-border-color: ${cardBorderColor}`,
    `--theme-card-radius: ${cardBorderRadius}`,
    `--theme-card-shadow: ${cardShadow}`,
    `--theme-text: ${textColor}`,
    `--theme-text-secondary: ${mutedTextColor}`,
    `--theme-accent: ${accentColor}`
  ].join('; ');

  const bgStyle = bgImage
    ? `background-image: url(${escapeHtml(bgImage)}); background-position: ${bgPosition}; background-repeat: ${bgRepeat}; background-size: ${bgSize};`
    : bgGradient
      ? `background: ${escapeHtml(bgGradient)};`
      : `background: ${bgColor};`;

