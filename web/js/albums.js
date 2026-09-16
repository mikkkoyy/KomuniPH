/**
 * KomuniPH Lite - Album page
 * Extracted verbatim from profile.js (PHASE-3 GALLERY-SPLIT-01).
 * Owns: album page rendering, album photos, album header/cover.
 */

import { albumsApi, profileApi } from './api.js';
import {
  galleryRoutes,
  renderGalleryShell,
  setGalleryStatus,
  renderGalleryUploadModule,
  initGalleryUpload,
  getGalleryUploadAlbumId,
  renderGalleryItemHtml,
  bindGalleryGridLightbox,
  isOwnUsername,
  parseGalleryHash,
  escapeHtmlAttr,
  escapeHtml,
} from './gallery.js';
import { applyGalleryBackground } from './profile.js';

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
          <span class="gallery-module-actions">
            ${isOwner
              ? `<button type="button" class="btn btn-secondary btn-sm" id="album-manage-toggle" onclick="window.toggleAlbumManage()">Manage Album</button>`
              : ''}
            <span class="gallery-album-owner">${isOwner ? 'Your album' : `@${escapeHtml(profileUsername)}`}</span>
          </span>
        </div>
        <div class="profile-module-body">
          <div class="album-header" id="album-header">
            <div class="album-cover" id="album-cover"></div>
            <div class="album-header-text">
              <h2 class="album-title" id="album-title">Loading album...</h2>
              <div class="album-meta" id="album-meta"></div>
              <div class="album-description" id="album-description"></div>
            </div>
          </div>

          ${isOwner ? renderAlbumManageFormHtml() : ''}

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
 * Owner-only album management form (rename, description, delete).
 * Reuses the app's existing .form / .album-form controls.
 */
function renderAlbumManageFormHtml() {
  return `
    <form class="form album-form" id="album-manage-form" style="display:none" novalidate>
      <div class="error-banner" id="album-manage-error" style="display:none"></div>
      <div class="form-group">
        <label class="form-label" for="album-manage-name">Album name</label>
        <input type="text" id="album-manage-name" class="form-input" maxlength="100" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="album-manage-description">Description (optional)</label>
        <textarea id="album-manage-description" rows="2" maxlength="300" placeholder="Describe this album"></textarea>
      </div>
      <div class="album-form-actions">
        <button type="submit" class="btn btn-primary" id="album-manage-save">Save Changes</button>
        <button type="button" class="btn btn-secondary" onclick="window.toggleAlbumManage(false)">Cancel</button>
        <button type="button" class="btn btn-danger" id="album-manage-delete">Delete Album</button>
        <span class="upload-status" id="album-manage-status"></span>
      </div>
      <div class="album-form-hint">
        To change the album cover, hover a photo below and choose &ldquo;Set cover&rdquo;.
        Deleting the album also deletes its photos.
      </div>
    </form>
  `;
}

/**
 * Initialise album management for the owner: rename, description and delete.
 * Ownership is enforced server-side — these controls only hide the buttons.
 */
function initAlbumManageForm(username) {
  const form = document.getElementById('album-manage-form');
  if (!form) return;

  const album = galleryRoutes.album;
  if (!album) return;

  const nameEl = document.getElementById('album-manage-name');
  const descriptionEl = document.getElementById('album-manage-description');
  // Prefill on every mount so the values reflect the latest saved album.
  if (nameEl) nameEl.value = album.name || '';
  if (descriptionEl) descriptionEl.value = album.description || '';

  if (form.dataset.bound === '1') return;
  form.dataset.bound = '1';

  const errorEl = document.getElementById('album-manage-error');
  const statusEl = document.getElementById('album-manage-status');
  const saveBtn = document.getElementById('album-manage-save');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.style.display = 'none';

    const name = (nameEl?.value || '').trim();
    if (!name) {
      if (errorEl) {
        errorEl.textContent = 'Album name cannot be empty';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      await albumsApi.updateAlbum(album.id, {
        name,
        description: (descriptionEl?.value || '').trim(),
      });
      await refreshAlbumPage();
      setGalleryStatus('Album updated.');
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || 'Could not update the album.';
        errorEl.style.display = 'block';
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
      if (statusEl) statusEl.textContent = '';
    }
  });

  const deleteBtn = document.getElementById('album-manage-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const count = (galleryRoutes.photos || []).length;
      const photoNote = count > 0
        ? ` and its ${count} photo${count === 1 ? '' : 's'}`
        : '';
      if (!window.confirm(`Delete the album "${album.name}"${photoNote}? This cannot be undone.`)) {
        return;
      }

      deleteBtn.disabled = true;
      try {
        await albumsApi.deleteAlbum(album.id);
        // Back to the gallery, which re-renders from fresh data.
        window.navigate(`/profile/${encodeURIComponent(username)}/photos`);
      } catch (err) {
        setGalleryStatus(`Could not delete album: ${err.message || 'Unknown error'}`, true);
        deleteBtn.disabled = false;
      }
    });
  }
}

/**
 * Show / hide the album management form.
 */
function toggleAlbumManage(open = null) {
  const form = document.getElementById('album-manage-form');
  if (!form) return;
  const shouldOpen = open === null ? form.style.display === 'none' : !!open;
  form.style.display = shouldOpen ? 'block' : 'none';

  const btn = document.getElementById('album-manage-toggle');
  if (btn) btn.textContent = shouldOpen ? 'Close' : 'Manage Album';
}

// Inline onclick handler used by the Manage Album button.
window.toggleAlbumManage = toggleAlbumManage;

/**
 * Set one of the album's own photos as the album cover (owner only).
 */
window.setAlbumCover = async function (photoId) {
  const album = galleryRoutes.album;
  if (!album || !galleryRoutes.isOwnProfile) return;
  if (album.cover_photo_id === photoId) return;

  try {
    await albumsApi.updateAlbum(album.id, { cover_photo_id: photoId });
    await refreshAlbumPage();
    setGalleryStatus('Album cover updated.');
  } catch (err) {
    setGalleryStatus(`Could not update the cover: ${err.message || 'Unknown error'}`, true);
  }
};

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
  if (galleryRoutes.isOwnProfile) {
    initGalleryUpload();
    initAlbumManageForm(profileUsername);
  }
  applyGalleryBackground(profileUsername);
}

/**
 * Refresh the mounted album page (after upload / delete).
 */
export async function refreshAlbumPage() {
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

  const descriptionEl = document.getElementById('album-description');
  if (descriptionEl) {
    const description = album ? (album.description || '') : '';
    descriptionEl.textContent = description;
    descriptionEl.style.display = description ? 'block' : 'none';
  }
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

  // Owner-only: each tile can be promoted to the album cover.
  const coverId = galleryRoutes.album ? galleryRoutes.album.cover_photo_id : null;
  gridEl.innerHTML = photos.map(photo => renderGalleryItemHtml(photo, isOwnProfile, {
    showCoverButton: isOwnProfile,
    isCover: !!coverId && photo.id === coverId,
  })).join('');

  // The lightbox navigates through this album's photos only.
  bindGalleryGridLightbox(gridEl, photos, photos);
}
