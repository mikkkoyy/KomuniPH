/**
 * KomuniPH Lite - Photo Gallery page + shared gallery modules
 * Extracted verbatim from profile.js (PHASE-3 GALLERY-SPLIT-01).
 *
 * Owns: dedicated gallery page, album cards, gallery upload queue,
 * shared gallery-item rendering, gallery/album shared state.
 */

import { profileApi, galleryApi, albumsApi, isAuthenticated, getCurrentUserProfile } from './api.js';
import { openLightbox } from './lightbox.js';
import { ensureProfilePicturesAlbum } from './profilePictures.js';
import { loadAndRenderGallery, applyGalleryBackground } from './profile.js';
import { refreshAlbumPage } from './albums.js';

/* HTML escaping helpers — copied verbatim from profile.js */
/**
 * Escape HTML
 */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
export function escapeHtmlAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * State shared by the dedicated gallery and album pages.
 */
export const galleryRoutes = {
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
export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}
/**
 * Parse the current hash into gallery route params.
 */
export function parseGalleryHash() {
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
export function isOwnUsername(username) {
  if (!isAuthenticated() || !username) return false;
  const cached = getCurrentUserProfile();
  if (!cached || !cached.username) return false;
  return String(cached.username).toLowerCase() === String(username).toLowerCase();
}
/**
 * Render a single gallery grid item
 */
export function renderGalleryItemHtml(photo, isOwnProfile) {
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
export function bindGalleryGridLightbox(gridEl, displayedPhotos, lightboxSource = displayedPhotos) {
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
export function initGalleryUpload() {
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
 * Shared owner-only upload toolbar used by the gallery and album pages.
 * Uses the same element ids as the profile sidebar so the existing
 * initGalleryUpload() multi-upload flow can be reused unchanged.
 */
export function renderGalleryUploadModule() {
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
export function getGalleryUploadAlbumId() {
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
 * Render the shared page shell for the gallery / album pages.
 * Reuses the profile frame so the user's background (Gradient Slate by default,
 * uploaded image when set) is applied exactly like on the profile page.
 */
export function renderGalleryShell({ username, activeNav, tagline, stripText, moduleHtml }) {
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
export function setGalleryStatus(message, isError = false) {
  const strip = document.getElementById('gallery-status-strip');
  if (!strip) return;
  strip.textContent = message || '';
  strip.style.color = isError ? '#dc2626' : '';
}
/**
 * Open an album from the gallery page using hash navigation.
 */
function openAlbumFromGallery(albumId) {
  if (!albumId) return;
  window.navigate(`/profile/${encodeURIComponent(galleryRoutes.username)}/photos/${encodeURIComponent(albumId)}`);
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
            <div class="photo-gallery-empty">No albums yet. + Create your first album.</div>
          </div>
        </div>
      </section>
    `,
  });
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
    // PROFILE-PICTURES-ALBUM-01: the Profile Pictures album row is created
    // lazily by GET /api/profile/profile-pictures-album. Fetch it for the
    // owner so a brand-new account (no album row yet) still sees the
    // Profile Pictures card on its gallery page.
    const ownProfile = galleryRoutes.isOwnProfile || isOwnUsername(profileUsername);
    const requests = [albumsApi.getAlbums(profileUsername), fetchGalleryPhotos(profileUsername)];
    if (ownProfile) {
      requests.push(ensureProfilePicturesAlbum());
    }
    const [albumResponse, photos, ownProfileAlbum] = await Promise.all(requests);

    galleryRoutes.albums = albumResponse.albums || [];
    if (ownProfileAlbum?.album &&
        !galleryRoutes.albums.some(a => a.id === ownProfileAlbum.album.id)) {
      galleryRoutes.albums = [ownProfileAlbum.album, ...galleryRoutes.albums];
    }
    galleryRoutes.photos = photos;
    galleryRoutes.isOwnProfile = ownProfile || !!albumResponse.is_own_profile;
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

/**
 * Initialize dedicated gallery page upload with drag-and-drop, preview, and progress.
 * Used on the standalone gallery page (not profile/album pages).
 */
export function initDedicatedGalleryUpload() {
  const dropzone = document.getElementById('gallery-upload-dropzone');
  const fileInput = document.getElementById('gallery-upload-file');
  const progress = document.getElementById('gallery-upload-progress');
  const progressBar = progress ? progress.querySelector('.gallery-upload-progress-bar') : null;
  const queueEl = document.getElementById('gallery-upload-queue');
  const uploadModule = document.getElementById('gallery-upload-module');

  if (!dropzone || !fileInput || !uploadModule) return;

  // Handle click to open file picker
  dropzone.addEventListener('click', (e) => {
    if (!e.target.matches('.gallery-upload-dropzone')) {
      fileInput.click();
    }
  });

  // Handle file selection
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });

  // Handle drag-and-drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('gallery-upload-dropzone--dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('gallery-upload-dropzone--dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('gallery-upload-dropzone--dragover');
    const files = e.dataTransfer.files;
    if (files.length) handleFiles(files);
  });

  /**
   * Process selected files: show previews, queue upload.
   */
  function handleFiles(files) {
    // Show preview thumbnails
    if (queueEl) queueEl.innerHTML = '';

    Array.from(files).forEach((file, idx) => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const thumbUrl = e.target.result;
        const previewHtml = `
          <div class="gallery-upload-preview" data-file-index="${idx}">
            <img src="${thumbUrl}" alt="Preview" style="width:80px;height:80px;object-fit:cover">
            <button class="gallery-upload-remove" aria-label="Remove">×</button>
            <span class="gallery-upload-filename">${escapeHtml(file.name)}</span>
          </div>
        `;
        if (queueEl) queueEl.insertAdjacentHTML('beforeend', previewHtml);
      };
      reader.readAsDataURL(file);
    });

    // Upload all images
    uploadPhotos(Array.from(files).filter(f => f.type.startsWith('image/')));
  }

  /**
   * Upload photos to the server.
   */
  async function uploadPhotos(files) {
    if (files.length === 0) return;

    // Show progress
    if (progressBar) {
      progress.style.display = 'block';
      progressBar.style.width = '0%';
    }

    const formData = new FormData();
    files.forEach(f => formData.append('photos', f));

    try {
      const response = await fetch('/api/profile/photos', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed: ${response.status}`);
      }

      const result = await response.json();
      // After upload, reload the gallery
      if (window.refreshActiveGalleryView) {
        await window.refreshActiveGalleryView();
      } else {
        refreshGalleryPage();
      }
      // Hide progress, clear queue
      if (progress) progress.style.display = 'none';
      if (queueEl) queueEl.innerHTML = '';
    } catch (err) {
      console.error('[GALLERY] Upload error:', err);
      if (progress) progress.style.display = 'none';
      alert(err.message || 'Upload failed. Try again.');
    }
  }
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
