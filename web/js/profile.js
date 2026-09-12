/**
 * KomuniPH Lite - Profile UI
 */

import { profileApi, isAuthenticated, getCurrentUserProfile, setCurrentUserProfile } from './api.js';
import { navigate } from './app.js';

// Last successfully loaded profile — used to restore values on Cancel
// and to re-render the view after a successful save (FEED-07).
let currentProfile = null;

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
    <div class="profile-page">
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
    </div>
  `;
}

/**
 * Setup photo input event listener
 */
function setupPhotoInput() {
  const photoInput = document.getElementById('photo-input');
  if (!photoInput) return;

  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const uploadBtn = document.getElementById('upload-btn');
    const status = document.getElementById('upload-status');
    
    if (file) {
      // Browser MIME is only a hint. Block obviously-non-image types up front,
      // but let the server validate the actual image contents (JPEG/PNG/WebP).
      // A valid image with an unexpected-but-harmless MIME must not be blocked.
      const isImage = !file.type || file.type.startsWith('image/');
      if (!isImage) {
        status.textContent = 'Invalid file type. Allowed: JPEG, PNG, WebP';
        status.className = 'upload-status error';
        uploadBtn.style.display = 'none';
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        status.textContent = 'File too large. Maximum size: 5MB';
        status.className = 'upload-status error';
        uploadBtn.style.display = 'none';
        return;
      }

      status.textContent = `Selected: ${file.name}`;
      status.className = 'upload-status success';
      uploadBtn.style.display = 'inline-block';
    } else {
      uploadBtn.style.display = 'none';
      status.textContent = '';
    }
  });
}

/**
 * Load profile
 */
window.loadProfile = async function() {
  const loading = document.getElementById('profile-loading');
  const content = document.getElementById('profile-content');
  const error = document.getElementById('profile-error');

  loading.style.display = 'block';
  content.style.display = 'none';
  error.style.display = 'none';

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
  return `
    <div class="profile-card">
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
 * Sends PATCH /api/profile and re-renders the view with the updated profile.
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

  // Client-side validation mirrors the server rules
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

  // Prevent duplicate submissions while saving
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

    // Success: refresh the visible profile immediately
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
