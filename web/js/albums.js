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
