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
  const displayName = profile.display_name || profile.username;
  const aliasValue = profile.alias || '';
  const bioValue = profile.bio || '';

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

  return `
    <div class="profile-card" style="${themeStyle}">
      <div class="profile-photo-section">
        ${createAvatar(profile.username, displayName, profile.profile_photo_url)}
        <div class="photo-upload-form">
          <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" style="display:none">
          <button class="btn btn-secondary" onclick="document.getElementById('photo-input').click()">Choose Photo</button>
          <button class="btn btn-primary" id="upload-btn" style="display:none" onclick="window.uploadPhoto()">Upload</button>
          <div id="upload-status" class="upload-status"></div>
        </div>
      </div>
      <div id="profile-view">
        <h2 class="profile-name">${escapeHtml(displayName)}</h2>
        <p class="profile-username">@${profile.username}</p>
        ${profile.alias
          ? `<p class="profile-alias">Alias: ${escapeHtml(profile.alias)}</p>`
          : '<p class="profile-alias empty">No alias set.</p>'
        }
        ${profile.bio
          ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>`
          : '<p class="profile-bio empty">No bio yet.</p>'
        }
        <button class="btn btn-secondary" id="edit-profile-btn" onclick="window.startEditProfile()">Edit Profile</button>
        <button class="btn btn-primary" id="customize-profile-btn" onclick="window.openCustomization()">Customize Profile</button>
      </div>
      <div id="profile-edit" style="display:none">
        <div class="form-group">
          <label for="edit-display-name">Display Name</label>
          <input type="text" id="edit-display-name" maxlength="100" value="${escapeHtml(displayName)}">
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

  const displayName = (currentProfile && (currentProfile.display_name || currentProfile.username)) || '';
  const aliasValue = (currentProfile && currentProfile.alias) || '';
  const bioValue = (currentProfile && currentProfile.bio) || '';

  const nameInput = document.getElementById('edit-display-name');
  const aliasInput = document.getElementById('edit-alias');
  const bioInput = document.getElementById('edit-bio');
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

  const displayName = (document.getElementById('edit-display-name')?.value || '').trim();
  const alias = (document.getElementById('edit-alias')?.value || '').trim();
  const bio = (document.getElementById('edit-bio')?.value || '').trim();

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
    const updated = await profileApi.updateProfile({
      display_name: displayName,
      alias,
      bio,
    });

    currentProfile = updated;
    const content = document.getElementById('profile-content');
    if (content) {
      content.innerHTML = renderProfileContent(updated);
      setupPhotoInput();
    }
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
  const cardOpacity = custom.cardOpacity != null ? custom.cardOpacity : 0.95;
  const cardBorderColor = custom.cardBorderColor || theme.border || '#f0dfc8';
  const cardBorderRadius = custom.cardBorderRadius || parseInt(theme.cardRadius) || 28;

  const setRadio = (name, value) => {
    const radio = panel.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  };

  setRadio('bg-type', bgType);

  const bgColorInput = document.getElementById('theme-backgroundColor');
  if (bgColorInput) bgColorInput.value = bgColor.startsWith('#') ? bgColor : '#fff7ec';

  const bgGradientSelect = document.getElementById('theme-backgroundGradient');
  if (bgGradientSelect) bgGradientSelect.value = bgGradient;

  const bgPositionSelect = document.getElementById('theme-backgroundPosition');
  if (bgPositionSelect) bgPositionSelect.value = bgPosition;

  const bgRepeatSelect = document.getElementById('theme-backgroundRepeat');
  if (bgRepeatSelect) bgRepeatSelect.value = bgRepeat;

  const bgSizeSelect = document.getElementById('theme-backgroundSize');
  if (bgSizeSelect) bgSizeSelect.value = bgSize;

  const textColorInput = document.getElementById('theme-textColor');
  if (textColorInput) textColorInput.value = textColor.startsWith('#') ? textColor : '#2a2130';

  const mutedTextColorInput = document.getElementById('theme-mutedTextColor');
  if (mutedTextColorInput) mutedTextColorInput.value = mutedTextColor.startsWith('#') ? mutedTextColor : '#6b6072';

  const accentColorInput = document.getElementById('theme-accentColor');
  if (accentColorInput) accentColorInput.value = accentColor.startsWith('#') ? accentColor : '#0e6e6e';

  const cardBgInput = document.getElementById('theme-cardBackground');
  if (cardBgInput) cardBgInput.value = cardBg.startsWith('#') ? cardBg : '#fff7ec';

  const cardOpacityInput = document.getElementById('theme-cardOpacity');
  if (cardOpacityInput) {
    cardOpacityInput.value = cardOpacity;
    const opacityValue = document.getElementById('theme-cardOpacity-value');
    if (opacityValue) opacityValue.textContent = cardOpacity;
  }

  const cardBorderColorInput = document.getElementById('theme-cardBorderColor');
  if (cardBorderColorInput) cardBorderColorInput.value = cardBorderColor.startsWith('#') ? cardBorderColor : '#f0dfc8';

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
  const card = document.querySelector('.profile-card');
  if (!card) return;

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

  const opacityValue = document.getElementById('theme-cardOpacity-value');
  if (opacityValue) opacityValue.textContent = cardOpacity.toFixed(2);

  const radiusValue = document.getElementById('theme-cardBorderRadius-value');
  if (radiusValue) radiusValue.textContent = `${cardBorderRadius}px`;

  let backgroundValue = bgColor;
  if (bgType === 'gradient' && bgGradient) {
    backgroundValue = bgGradient;
  }

  card.style.setProperty('--theme-background', backgroundValue);
  card.style.setProperty('--theme-card-background', cardBg);
  card.style.setProperty('--theme-card-opacity', cardOpacity);
  card.style.setProperty('--theme-card-border-color', cardBorderColor);
  card.style.setProperty('--theme-card-radius', `${cardBorderRadius}px`);
  card.style.setProperty('--theme-text', textColor);
  card.style.setProperty('--theme-text-secondary', mutedTextColor);
  card.style.setProperty('--theme-accent', accentColor);

  if (bgType === 'image') {
    const bgImage = currentProfile?.theme?.custom?.backgroundImage || currentProfile?.theme?.config?.backgroundImage || '';
    if (bgImage) {
      card.style.backgroundImage = `url(${bgImage})`;
      card.style.backgroundPosition = bgPosition;
      card.style.backgroundRepeat = bgRepeat;
      card.style.backgroundSize = bgSize;
      card.style.background = 'none';
    } else {
      card.style.backgroundImage = '';
      card.style.background = backgroundValue;
    }
  } else {
    card.style.backgroundImage = '';
    card.style.background = backgroundValue;
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
    const content = document.getElementById('profile-content');
    if (content) {
      content.innerHTML = renderProfileContent(updated);
      setupPhotoInput();
    }
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
    const content = document.getElementById('profile-content');
    if (content) {
      content.innerHTML = renderProfileContent(updated);
      setupPhotoInput();
    }
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

    const content = document.getElementById('profile-content');
    if (content) {
      content.innerHTML = renderProfileContent(updatedProfile);
      setupPhotoInput();
    }

    const sidebarImg = document.getElementById('sidebar-avatar-img');
    const sidebarInitials = document.getElementById('sidebar-avatar-initials');
    const sidebarName = document.getElementById('sidebar-display-name');
    const sidebarAlias = document.getElementById('sidebar-alias');
    const displayName = updatedProfile.display_name || updatedProfile.username;
    const alias = updatedProfile.alias_enabled && updatedProfile.alias ? updatedProfile.alias : '';

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
