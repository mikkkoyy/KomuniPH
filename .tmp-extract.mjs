/**
 * PHASE-3 extraction: move Gallery/Album/Lightbox functions out of profile.js
 * into gallery.js / albums.js / lightbox.js / profilePictures.js with minimal
 * behavioral changes (code is moved verbatim via brace matching).
 */
import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('web/js/profile.js', 'utf8');
const lines = src.split('\n');

/** Find the start line index (0-based) of `function NAME(` / `async function NAME(` / `window.NAME =` */
function findStart(name) {
  const pats = [
    new RegExp(`^(export )?(async )?function ${name}\\(`),
    new RegExp(`^window\\.${name} = `),
  ];
  for (let i = 0; i < lines.length; i++) {
    if (pats.some(p => p.test(lines[i]))) return i;
  }
  throw new Error(`function not found: ${name}`);
}

/** Capture a block starting at `start` (line idx) through its matching close brace,
 *  including any immediately preceding comment block, and any trailing
 *  `window.X = ...` binding lines that belong to it. */
function captureBlock(start) {
  // include preceding comment lines
  let s = start;
  while (s > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[s - 1] || '')) s--;
  // brace match from the first '{' at/after start
  let depth = 0, began = false, end = -1;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; began = true; }
      else if (ch === '}') { depth--; }
    }
    if (began && depth === 0) { end = i; break; }
  }
  if (end === -1) throw new Error(`unbalanced braces at ${lines[start]}`);
  return { text: lines.slice(s, end + 1).join('\n'), s, end };
}

/** Top-level const object capture (e.g. galleryRoutes) */
function captureConst(name) {
  const start = lines.findIndex(l => new RegExp(`^const ${name} = `).test(l));
  if (start === -1) throw new Error(`const not found: ${name}`);
  return captureBlock(start);
}

const removed = []; // {s, end} ranges to strip from profile.js
const grab = (name) => {
  const start = findStart(name);
  const block = captureBlock(start);
  removed.push(block);
  return block.text;
};
const grabConst = (name) => {
  const block = captureConst(name);
  removed.push(block);
  return block.text;
};

/* ---------------- lightbox.js ---------------- */
const lbOpen = grab('openLightbox');
const lbClose = grab('closeLightbox');
const lbKey = grab('handleLightboxKeydown');
const lbPrev = grab('lightboxPrev');
const lbNext = grab('lightboxNext');
const lbUpdate = grab('updateLightboxImage');
const lbState = `/**
 * Lightbox state
 */
let lightboxPhotos = [];
let lightboxIndex = 0;
`;

const lightboxJs = `/**
 * KomuniPH Lite - Gallery Lightbox
 * Extracted verbatim from profile.js (PHASE-3 GALLERY-SPLIT-01).
 * Owns the full-screen photo lightbox only.
 */

${lbState}
${lbOpen}
${lbClose}
${lbKey}
${lbPrev}
${lbNext}
${lbUpdate}

// Expose lightbox functions globally (used by the lightbox buttons' onclick)
window.closeLightbox = closeLightbox;
window.lightboxPrev = lightboxPrev;
window.lightboxNext = lightboxNext;
`;
writeFileSync('web/js/lightbox.js', lightboxJs);
console.log('lightbox.js written');

/** Capture WITHOUT removing (shared helpers stay in profile.js) */
const peek = (name) => captureBlock(findStart(name)).text;

/* ---------------- shared helpers captured for gallery.js ---------------- */
const escapeHtmlFn = peek('escapeHtml');
const escapeHtmlAttrFn = peek('escapeHtmlAttr');
const gRoutes = grabConst('galleryRoutes');
const safeDecodeFn = grab('safeDecode');
const parseHashFn = grab('parseGalleryHash');
const isOwnFn = grab('isOwnUsername');
const shellFn = grab('renderGalleryShell');
const albumCardFn = grab('renderAlbumCardHtml');
const itemHtmlFn = grab('renderGalleryItemHtml');
const bindLbFn = grab('bindGalleryGridLightbox');
const uploadFn = grab('initGalleryUpload');
const uploadModuleFn = grab('renderGalleryUploadModule');
const uploadAlbumIdFn = grab('getGalleryUploadAlbumId');
const refreshActiveFn = grab('refreshActiveGalleryView');
const galleryPageFn = grab('renderGalleryPage');
const initGalleryFn = grab('initGalleryPage');
// Delegate Profile Pictures album creation to profilePictures.js
var patchedInitGallery = initGalleryFn.replace(
  'albumsApi.getProfilePicturesAlbum().catch(() => null)',
  'ensureProfilePicturesAlbum()'
);
if (patchedInitGallery === initGalleryFn) throw new Error('initGalleryPage patch did not apply');
const refreshGalleryFn = grab('refreshGalleryPage');
const fetchPhotosFn = grab('fetchGalleryPhotos');
const renderAlbumsFn = grab('renderGalleryAlbums');
const setStatusFn = grab('setGalleryStatus');
const openAlbumNavFn = grab('openAlbumFromGallery');
const openGalleryPageFn = grab('openGalleryPage');   // window.openGalleryPage = ...
const deletePhotoFn = grab('deleteGalleryPhoto');     // window.deleteGalleryPhoto = ...

const galleryJs = `/**
 * KomuniPH Lite - Photo Gallery page + shared gallery modules
 * Extracted verbatim from profile.js (PHASE-3 GALLERY-SPLIT-01).
 *
 * Owns: dedicated gallery page, album cards, gallery upload queue,
 * shared gallery-item rendering, gallery/album shared state.
 */

import { profileApi, galleryApi, albumsApi, getCurrentUserProfile } from './api.js';
import { openLightbox } from './lightbox.js';
import { ensureProfilePicturesAlbum } from './profilePictures.js';
import { loadAndRenderGallery, applyGalleryBackground } from './profile.js';

/* HTML escaping helpers — copied verbatim from profile.js */
${escapeHtmlFn.replace(/^function escapeHtml/, 'export function escapeHtml')}
${escapeHtmlAttrFn.replace(/^function escapeHtmlAttr/, 'export function escapeHtmlAttr')}

${gRoutes.replace(/^const galleryRoutes/, 'export const galleryRoutes')}
${safeDecodeFn.replace(/^function safeDecode/, 'export function safeDecode')}
${parseHashFn}
${isOwnFn.replace(/^function isOwnUsername/, 'export function isOwnUsername')}
${itemHtmlFn.replace(/^function renderGalleryItemHtml/, 'export function renderGalleryItemHtml')}
${bindLbFn.replace(/^function bindGalleryGridLightbox/, 'export function bindGalleryGridLightbox')}
${uploadFn.replace(/^async function initGalleryUpload/, 'export async function initGalleryUpload')}
${uploadModuleFn.replace(/^function renderGalleryUploadModule/, 'export function renderGalleryUploadModule')}
${uploadAlbumIdFn.replace(/^function getGalleryUploadAlbumId/, 'export function getGalleryUploadAlbumId')}
${refreshActiveFn}
${shellFn.replace(/^function renderGalleryShell/, 'export function renderGalleryShell')}
${albumCardFn}
${fetchPhotosFn}
${renderAlbumsFn}
${setStatusFn.replace(/^function setGalleryStatus/, 'export function setGalleryStatus')}
${openAlbumNavFn}

${galleryPageFn}

${patchedInitGallery}
${refreshGalleryFn}
${deletePhotoFn}
${openGalleryPageFn}
`;
writeFileSync('web/js/gallery.js', galleryJs);
console.log('gallery.js written');

/* ---------------- albums.js ---------------- */
const albumPageFn = grab('renderAlbumPage');
const initAlbumFn = grab('initAlbumPage');
const refreshAlbumFn = grab('refreshAlbumPage');
const sortPhotosFn = grab('sortPhotosByNewest');
const albumHeaderFn = grab('renderAlbumHeader');
const albumPhotosFn = grab('renderAlbumPhotos');

const albumsJs = `/**
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
  escapeHtml,
} from './gallery.js';
import { applyGalleryBackground } from './profile.js';

${albumPageFn.replace(/^function renderAlbumPage/, 'export function renderAlbumPage')}

${initAlbumFn}

${refreshAlbumFn}
${sortPhotosFn}
${albumHeaderFn}
${albumPhotosFn}
`;
writeFileSync('web/js/albums.js', albumsJs);
console.log('albums.js written');

/* ---------------- profilePictures.js ---------------- */
const profilePicturesJs = `/**
 * KomuniPH Lite - Profile Pictures album
 * Owns: the Profile Pictures album (photo album type = 'profile') and the
 * owner-side guarantee that it exists before the gallery lists it.
 *
 * The album row itself is created lazily by the backend endpoint
 * GET /api/profile/profile-pictures-album (see server/albums.js);
 * this module is the frontend wrapper for that behavior.
 */

import { albumsApi } from './api.js';

/**
 * Ensure the Profile Pictures album exists for the signed-in user and
 * return its API response ({ album: {...} }) or null on failure.
 */
export async function ensureProfilePicturesAlbum() {
  try {
    return await albumsApi.getProfilePicturesAlbum();
  } catch {
    return null;
  }
}

/**
 * Check whether an album payload is the Profile Pictures album.
 */
export function isProfilePicturesAlbum(album) {
  return !!album && (album.is_profile_pictures === true || album.type === 'profile');
}
`;
writeFileSync('web/js/profilePictures.js', profilePicturesJs);
console.log('profilePictures.js written');

/* ---------------- rewrite profile.js ---------------- */
// Remove captured blocks (highest start first so indices stay valid)
removed.sort((a, b) => b.s - a.s);
let outLines = lines.slice();
let removedCount = 0;
for (const r of removed) {
  outLines.splice(r.s, r.end - r.s + 1);
  removedCount++;
}
let profileOut = outLines.join('\n');

// Export the two functions gallery.js/albums.js need from profile.js
profileOut = profileOut.replace(
  /^async function loadAndRenderGallery/m,
  'export async function loadAndRenderGallery'
);
profileOut = profileOut.replace(
  /^async function applyGalleryBackground/m,
  'export async function applyGalleryBackground'
);

// Add the gallery.js import right after the navigate import
profileOut = profileOut.replace(
  "import { navigate } from './app.js';",
  "import { navigate } from './app.js';\n" +
  "import { renderGalleryItemHtml, bindGalleryGridLightbox, initGalleryUpload, isOwnUsername, safeDecode } from './gallery.js'; // PHASE-3 GALLERY-SPLIT-01"
);

writeFileSync('web/js/profile.js', profileOut);
console.log('profile.js rewritten; removed blocks:', removedCount);

/* ---------------- rewrite app.js imports ---------------- */
const appPath = 'web/js/app.js';
let appJs = readFileSync(appPath, 'utf8');
appJs = appJs.replace(
  "import { renderProfilePage, initProfilePage, renderGalleryPage, initGalleryPage, renderAlbumPage, initAlbumPage } from './profile.js';",
  "import { renderProfilePage, initProfilePage } from './profile.js';\n" +
  "// PHASE-3 GALLERY-SPLIT-01: gallery/album pages live in their own modules\n" +
  "import { renderGalleryPage, initGalleryPage } from './gallery.js';\n" +
  "import { renderAlbumPage, initAlbumPage } from './albums.js';"
);
writeFileSync(appPath, appJs);
console.log('app.js rewritten');


