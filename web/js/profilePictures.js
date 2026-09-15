/**
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
