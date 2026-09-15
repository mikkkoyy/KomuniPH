/**
 * KomuniPH Lite - Gallery Lightbox
 * Extracted verbatim from profile.js (PHASE-3 GALLERY-SPLIT-01).
 * Owns the full-screen photo lightbox only.
 */

/**
 * Lightbox state
 */
let lightboxPhotos = [];
let lightboxIndex = 0;

/**
 * Open lightbox with photos array and starting index
 */
export function openLightbox(photos, index) {
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

// Expose lightbox functions globally (used by the lightbox buttons' onclick)
window.closeLightbox = closeLightbox;
window.lightboxPrev = lightboxPrev;
window.lightboxNext = lightboxNext;
