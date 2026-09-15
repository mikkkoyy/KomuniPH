/* =========================================================================
 * GALLERY-ROUTES-01: dedicated Photo Gallery + Album pages (hash routes)
 *
 * This app uses hash routing, so the dedicated gallery lives at:
 *   #/profile/:username/photos
 *   #/profile/:username/photos/:albumId
 *
 * Navigation always goes through navigate() / <a href="#/..."> so refresh,
 * Back and Forward keep working with no server-side SPA routes needed.
 * ========================================================================= */

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
 * Returns { page: null } when the hash is not a gallery/album route.
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
 * Reuses the profile frame so the owner's background (Gradient Slate by
 * default, uploaded image when set) is applied exactly like on the profile.
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
          <a href="#/profile/${escapeHtmlAttr(username)}" class="profile-nav-link">Profile</a>
          <a href="#/profile/${escapeHtmlAttr(username)}/photos" class="profile-nav-link${activeNav === 'gallery' ? ' profile-nav-active' : ''}">Photo Gallery</a>
          ${isAuthenticated()
            ? '<button type="button" class="profile-nav-link profile-nav-link-logout" onclick="window.handleLogout()">Log Out</button>'
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
 * Owner-only upload toolbar used by the gallery and album pages.
 * Uses the same element ids as the profile sidebar so the existing
 * initGalleryUpload() multi-upload flow is reused unchanged.
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
 * Cosmetic only — never break a page over the background.
 */
async function applyGalleryBackground(username) {
  if (!username) return;
  try {
    const profile = await profileApi.getPublicProfile(username);
    applyProfileBackground(profile);
  } catch (err) {
    console.warn('[GALLERY] Could not load profile background:', err.message || err);
  }
}

/**
 * Fetch gallery photos for a username.
 * The owner uses the authenticated endpoint (private photos included),
 * every other visitor uses the public read-only feed.
 */
async function fetchGalleryPhotos(username, isOwnProfile) {
  const response = isOwnProfile
    ? await galleryApi.getOwnPhotos()
    : await galleryApi.getPhotos(username);
  return response.photos || [];
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
 * Render one album card. The card is a plain hash link so refresh,
 * Back and Forward all work without server-side routing.
 */
function renderAlbumCardHtml(album, username) {
  const coverThumb = album.cover_photo_url || '';
  const photoCount = album.photo_count || 0;
  const isProfilePictures = album.is_profile_pictures || album.type === 'profile';

  return `
    <a class="gallery-album-card" href="#/profile/${escapeHtmlAttr(username)}/photos/${escapeHtmlAttr(album.id)}">
      <div class="gallery-album-cover">
        ${coverThumb
          ? `<img src="${escapeHtmlAttr(coverThumb)}" alt="${escapeHtmlAttr(album.name)}" loading="lazy">`
          : '<span class="gallery-album-cover-placeholder">No photos</span>'}
      </div>
      <div class="gallery-album-name">${escapeHtml(album.name)}${isProfilePictures ? ' <span class="gallery-album-badge">Profile</span>' : ''}</div>
      <div class="gallery-album-count">${photoCount} photo${photoCount === 1 ? '' : 's'}</div>
    </a>
  `;
}

/**
 * Render the album grid of the dedicated gallery page.
 * Profile Pictures is always ordered first, then the normal albums.
 */
function renderGalleryAlbums() {
  const gridEl = document.getElementById('gallery-albums-grid');
  if (!gridEl) return;

  const username = galleryRoutes.username;
  const albums = (galleryRoutes.albums || []).slice().sort((a, b) => {
    const rank = (album) => (album.is_profile_pictures || album.type === 'profile' ? 0 : 1);
    return rank(a) - rank(b);
  });

  const totalEl = document.getElementById('gallery-album-total');
  if (totalEl) {
    const totalPhotos = albums.reduce((sum, album) => sum + (album.photo_count || 0), 0);
    totalEl.textContent = `${albums.length} album${albums.length === 1 ? '' : 's'} · ${totalPhotos} photo${totalPhotos === 1 ? '' : 's'}`;
  }

  if (albums.length === 0) {
    gridEl.innerHTML = `
      <div class="photo-gallery-empty">
        No albums yet.${galleryRoutes.isOwnProfile ? ' Upload photos to start your gallery.' : ''}
      </div>
    `;
    return;
  }

  gridEl.innerHTML = `<div class="gallery-album-grid">${
    albums.map(album => renderAlbumCardHtml(album, username)).join('')
  }</div>`;
}

/**
 * Render every photo of the gallery into the "All Photos" module.
 * The lightbox navigates through all of these photos.
 */
function renderGalleryAllPhotos() {
  const gridEl = document.getElementById('gallery-all-photos-grid');
  const emptyEl = document.getElementById('gallery-all-photos-empty');
  if (!gridEl || !emptyEl) return;

  const photos = sortPhotosByNewest(galleryRoutes.photos);

  if (photos.length === 0) {
    gridEl.style.display = 'none';
    gridEl.innerHTML = '';
    emptyEl.style.display = 'block';
    emptyEl.textContent = galleryRoutes.isOwnProfile
      ? 'No photos yet. Use Upload Photos to add some.'
      : 'No photos yet.';
    return;
  }

  emptyEl.style.display = 'none';
  gridEl.style.display = 'grid';
  gridEl.innerHTML = photos.map(photo => renderGalleryItemHtml(photo, galleryRoutes.isOwnProfile)).join('');
  bindGalleryGridLightbox(gridEl, photos, photos);
}

/**
 * Render the dedicated Photo Gallery page for a username.
 * Public and read-only for visitors of another profile.
 *
 * @param {string} username - profile owner
 * @returns {string} page HTML
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
    stripText: 'Loading gallery...',
    moduleHtml: `
      <section class="profile-module" id="gallery-albums-module">
        <div class="profile-module-header">
          <span>Albums</span>
          <span class="gallery-module-meta" id="gallery-album-total"></span>
        </div>
        <div class="profile-module-body">
          ${galleryRoutes.isOwnProfile ? renderGalleryUploadModule() : ''}
          <div class="gallery-albums" id="gallery-albums-grid">
            <div class="photo-gallery-empty">Loading albums...</div>
          </div>
        </div>
      </section>

      <section class="profile-module" id="gallery-photos-module">
        <div class="profile-module-header">
          <span>All Photos</span>
          <a class="gallery-back-link" href="#/profile/${escapeHtmlAttr(profileUsername)}">Back to Profile</a>
        </div>
        <div class="profile-module-body">
          <div class="photo-gallery" id="gallery-all-photos">
            <div class="photo-gallery-empty" id="gallery-all-photos-empty">Loading photos...</div>
            <div class="photo-gallery-grid" id="gallery-all-photos-grid" style="display:none"></div>
          </div>
        </div>
      </section>
    `,
  });
}

/**
 * Initialize the dedicated Photo Gallery page: load albums + photos, show the
 * Profile Pictures album first and wire up the lightbox.
 *
 * @param {string} username - profile owner
 */
export async function initGalleryPage(username) {
  const params = parseGalleryHash();
  const profileUsername = username || params.username || galleryRoutes.username;

  if (!profileUsername) {
    setGalleryStatus('Unable to determine which gallery to show. Please log in again.', true);
    return;
  }

  galleryRoutes.page = 'gallery';
  galleryRoutes.username = profileUsername;
  galleryRoutes.albumId = null;
  galleryRoutes.isOwnProfile = isOwnUsername(profileUsername);
  galleryRoutes.photos = [];
  galleryRoutes.albums = [];
  galleryRoutes.album = null;

  await loadGalleryPageData(profileUsername);
}

/**
 * Load the gallery page data (albums + photos) and render it.
 * Safe to call again to refresh the mounted page.
 */
async function loadGalleryPageData(profileUsername) {
  try {
    const [albumsResponse, photos] = await Promise.all([
      albumsApi.getAlbums(profileUsername),
      fetchGalleryPhotos(profileUsername, galleryRoutes.isOwnProfile),
    ]);

    // A hash navigation may have unmounted this page mid-request.
    if (galleryRoutes.page !== 'gallery' || !document.getElementById('gallery-content')) return;

    galleryRoutes.albums = albumsResponse.albums || [];
    galleryRoutes.photos = sortPhotosByNewest(photos);
  } catch (err) {
    console.error('[GALLERY] Failed to load gallery page:', err);
    if (!document.getElementById('gallery-content')) return;

    galleryRoutes.albums = [];
    galleryRoutes.photos = [];
    const albumsGrid = document.getElementById('gallery-albums-grid');
    if (albumsGrid) albumsGrid.innerHTML = '<div class="photo-gallery-empty">Could not load albums.</div>';
    setGalleryStatus(err.message || 'Failed to load gallery.', true);
    renderGalleryAllPhotos();
    applyGalleryBackground(profileUsername);
    return;
  }

  if (galleryRoutes.isOwnProfile) initGalleryUpload();
  renderGalleryAlbums();
  renderGalleryAllPhotos();
  applyGalleryBackground(profileUsername);

  const totalPhotos = galleryRoutes.photos.length;
  setGalleryStatus(`@${profileUsername} · ${totalPhotos} photo${totalPhotos === 1 ? '' : 's'} in ${galleryRoutes.albums.length} album${galleryRoutes.albums.length === 1 ? '' : 's'}`);
}

/**
 * Refresh the mounted gallery page (after upload / delete).
 */
async function refreshGalleryPage() {
  if (galleryRoutes.page !== 'gallery' || !galleryRoutes.username) return;
  await loadGalleryPageData(galleryRoutes.username);
}

/**
 * Render the album page for one album of a profile.
 * Only the photos that belong to the requested album are shown.
 *
 * @param {string} username
 * @param {string} albumId
 * @returns {string} page HTML
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
          <a href="#/profile/${escapeHtmlAttr(profileUsername)}/photos" class="gallery-back-to-gallery">&larr; Back to Gallery</a>
          <span class="gallery-album-owner">${isOwner ? 'Your album' : `@${escapeHtmlAttr(profileUsername)}`}</span>
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
 * Initialize the album page: load the album and show ONLY its own photos.
 * Works for visitors too — the album endpoint is public read-only.
 *
 * @param {string} username
 * @param {string} albumId
 */
export async function initAlbumPage(username, albumId) {
  const params = parseGalleryHash();
  const profileUsername = username || params.username || galleryRoutes.username;
  const targetAlbumId = albumId || params.albumId || galleryRoutes.albumId;

  if (!profileUsername || !targetAlbumId) {
    setGalleryStatus('Album not found.', true);
    renderAlbumPhotos([], false);
    return;
  }

  galleryRoutes.page = 'album';
  galleryRoutes.username = profileUsername;
  galleryRoutes.albumId = targetAlbumId;
  galleryRoutes.isOwnProfile = isOwnUsername(profileUsername);
  galleryRoutes.photos = [];
  galleryRoutes.albums = [];
  galleryRoutes.album = null;

  try {
    // The album endpoint returns the album with ONLY its own photos, so the
    // album page never mixes photos from other albums (public read-only).
    const response = await albumsApi.getAlbum(profileUsername, targetAlbumId);

    if (galleryRoutes.page !== 'album' || !document.getElementById('gallery-content')) return;

    galleryRoutes.album = response.album || null;
    galleryRoutes.photos = sortPhotosByNewest(response.photos || []);
  } catch (err) {
    console.error('[GALLERY] Failed to load album:', err);
    if (!document.getElementById('gallery-content')) return;

    galleryRoutes.album = null;
    galleryRoutes.photos = [];
    setGalleryStatus(`Failed to load album: ${err.message || 'Unknown error'}`, true);
    renderAlbumHeader(profileUsername);
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
  if (galleryRoutes.page !== 'album' || !galleryRoutes.albumId) return;
  await initAlbumPage(galleryRoutes.username, galleryRoutes.albumId);
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
  if (metaEl) {
    const description = album && album.description ? ` · ${album.description}` : '';
    metaEl.textContent = `${count} photo${count === 1 ? '' : 's'} · @${username}${description}`;
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
  gridEl.innerHTML = photos.map(photo => renderGalleryItemHtml(photo, isOwnProfile)).join('');

  // The lightbox navigates through this album's photos only.
  bindGalleryGridLightbox(gridEl, photos, photos);
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
