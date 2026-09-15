/**
 * Temporary diagnostic: map declarations in web/js/profile.js to detect
 * duplicated blocks left by the earlier partial attempt.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const src = readFileSync('web/js/profile.js', 'utf8');
const lines = src.split('\n');
const needle = [
  'const galleryRoutes',
  'function parseGalleryHash',
  'function renderGalleryShell',
  'function safeDecode',
  'function isOwnUsername',
  'function refreshGalleryPage',
  'function refreshAlbumPage',
  'function renderGalleryPageData',
  'function renderGalleryGridHtml',
  'function renderAlbumCardsHtml',
  'function renderGallery(photos',
  'function bindGalleryGridLightbox',
  'function renderGalleryItemHtml',
  'export function renderGalleryPage',
  'export function initGalleryPage',
  'export function renderAlbumPage',
  'export function initAlbumPage',
  'const PROFILE_GALLERY_PREVIEW_LIMIT',
  'function loadAndRenderGallery',
  'function initGalleryUpload',
  'window.openGalleryPage',
  '/* ====',
];

const out = lines.map((line, i) => ({ n: i + 1, line }))
  .filter(({ line }) => needle.some(nd => line.includes(nd)))
  .map(({ n, line }) => `${n}: ${line.trim()}`);

let check = 'node --check OK';
try {
  execSync('node --check web/js/profile.js', { stdio: 'pipe' });
} catch (err) {
  check = 'node --check FAILED:\n' + (err.stderr?.toString() || err.message);
}

writeFileSync('.tmp-test/decl-scan.txt', out.join('\n') + '\n\n' + check + '\n', 'utf8');
console.log('ok');