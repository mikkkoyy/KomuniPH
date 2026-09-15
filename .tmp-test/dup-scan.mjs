import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('web/js/profile.js', 'utf8');
const lines = src.split(/\r?\n/);

const names = [
  'function renderGalleryShell', 'function parseGalleryHash', 'function isOwnUsername',
  'function safeDecode', 'function renderGalleryItemHtml', 'function bindGalleryGridLightbox',
  'function renderGalleryPreviewMeta', 'function renderGalleryAlbums', 'function renderAlbumCardHtml',
  'export function renderGalleryPage', 'export function initGalleryPage',
  'export function renderAlbumPage', 'export function initAlbumPage',
  'function renderGalleryUploadModule', 'function fetchGalleryPhotos',
  'function fetchAlbumPhotos', 'function applyGalleryBackground', 'function setGalleryStatus',
  'function refreshGalleryPage', 'function refreshAlbumPage', 'function sortPhotosByNewest',
  'const PROFILE_GALLERY_PREVIEW_LIMIT', 'const galleryRoutes', 'function renderAlbumPhotos',
  'function renderAlbumHeader', 'function initGalleryUpload', 'function openLightbox',
  'function escapeHtml(', 'function escapeHtmlAttr(',
];

const report = [];
for (const n of names) {
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(n)) hits.push(i + 1); });
  report.push(`${n} -> [${hits.join(', ')}]${hits.length > 1 ? '  <== DUPLICATE' : ''}`);
}

// Where do the duplicate blocks start? Show surroundings of each duplicate.
writeFileSync('.tmp-test/dup-scan.txt', report.join('\n'), 'utf8');
console.log(report.join('\n'));