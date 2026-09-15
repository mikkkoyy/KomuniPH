/**
 * KomuniPH Lite - Photo Albums
 * Album management API routes
 */

import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import config from './config.js';
import { queryOne, queryAll, execute } from './database.js';
import { jsonResponse, errorResponse, parseBody } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const galleryUploadDir = resolve(__dirname, '..', 'uploads/gallery');
const galleryThumbnailDir = resolve(__dirname, '..', 'uploads/gallery/thumbnails');

const ALBUM_TYPES = ['general', 'profile'];

/**
 * Handle GET /api/profile/albums
 * Returns all albums for the authenticated user.
 */
export async function handleGetOwnAlbums(req, res, user) {
  try {
    const albums = queryAll(`
      SELECT
        a.id,
        a.user_id,
        a.name,
        a.description,
        a.type,
        a.cover_photo_id,
        a.created_at,
        a.updated_at,
        (SELECT COUNT(*) FROM profile_photos p WHERE p.album_id = a.id AND p.status = 'active') as photo_count
      FROM photo_albums a
      WHERE a.user_id = ?
      ORDER BY a.type DESC, a.updated_at DESC
    `, [user.sub]);

    const transformed = await Promise.all(albums.map(async (album) => {
      let coverUrl = null;
      if (album.cover_photo_id) {
        const coverPhoto = queryOne(
          'SELECT file_path FROM profile_photos WHERE id = ?',
          [album.cover_photo_id]
        );
        if (coverPhoto) {
          coverUrl = `/uploads/gallery/thumbnails/${coverPhoto.file_path}`;
        }
      } else if (album.photo_count > 0) {
        // Use newest photo as fallback cover
        const newestPhoto = queryOne(
          'SELECT file_path FROM profile_photos WHERE album_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
          [album.id, 'active']
        );
        if (newestPhoto) {
          coverUrl = `/uploads/gallery/thumbnails/${newestPhoto.file_path}`;
        }
      }
      return {
        id: album.id,
        name: album.name,
        description: album.description || '',
        type: album.type,
        cover_photo_url: coverUrl,
        photo_count: album.photo_count || 0,
        created_at: album.created_at,
        updated_at: album.updated_at,
      };
    }));

    jsonResponse(res, 200, { albums: transformed });
  } catch (err) {
    console.error('[ALBUMS] Get own albums error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/profiles/:username/albums
 * Returns public albums for a profile by username.
 */
export function handleGetAlbums(req, res, params) {
  try {
    const username = params.username ? params.username.toLowerCase() : '';

    const profile = queryOne(
      'SELECT user_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username = ?',
      [username]
    );

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const albums = queryAll(`
      SELECT
        a.id,
        a.user_id,
        a.name,
        a.description,
        a.type,
        a.cover_photo_id,
        a.created_at,
        a.updated_at,
        (SELECT COUNT(*) FROM profile_photos p WHERE p.album_id = a.id AND p.status = 'active') as photo_count
      FROM photo_albums a
      WHERE a.user_id = ? AND a.type = 'general'
      ORDER BY a.updated_at DESC
    `, [profile.user_id]);

    const transformed = await Promise.all(albums.map(async (album) => {
      let coverUrl = null;
      if (album.cover_photo_id) {
        const coverPhoto = queryOne(
          'SELECT file_path FROM profile_photos WHERE id = ?',
          [album.cover_photo_id]
        );
        if (coverPhoto) {
          coverUrl = `/uploads/gallery/thumbnails/${coverPhoto.file_path}`;
        }
      } else if (album.photo_count > 0) {
        const newestPhoto = queryOne(
          'SELECT file_path FROM profile_photos WHERE album_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
          [album.id, 'active']
        );
        if (newestPhoto) {
          coverUrl = `/uploads/gallery/thumbnails/${newestPhoto.file_path}`;
        }
      }
      return {
        id: album.id,
        name: album.name,
        description: album.description || '',
        type: album.type,
        cover_photo_url: coverUrl,
        photo_count: album.photo_count || 0,
        created_at: album.created_at,
        updated_at: album.updated_at,
      };
    }));

    jsonResponse(res, 200, { albums: transformed });
  } catch (err) {
    console.error('[ALBUMS] Get albums error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/profiles/:username/albums/:albumId
 * Returns a specific album with its photos.
 */
export function handleGetAlbum(req, res, params) {
  try {
    const username = params.username ? params.username.toLowerCase() : '';

    const profile = queryOne(
      'SELECT user_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username = ?',
      [username]
    );

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const album = queryOne(
      'SELECT * FROM photo_albums WHERE id = ? AND user_id = ?',
      [params.albumId, profile.user_id]
    );

    if (!album) {
      return errorResponse(res, 404, 'Album not found');
    }

    const limit = Math.min(parseInt(params.limit || '50', 10), 100);
    const offset = parseInt(params.offset || '0', 10);

    const photos = queryAll(`
      SELECT
        id,
        profile_user_id,
        album_id,
        file_path,
        caption,
        created_at,
        updated_at,
        status
      FROM profile_photos
      WHERE album_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [album.id, limit, offset]);

    let coverUrl = null;
    if (album.cover_photo_id) {
      const coverPhoto = queryOne(
        'SELECT file_path FROM profile_photos WHERE id = ?',
        [album.cover_photo_id]
      );
      if (coverPhoto) {
        coverUrl = `/uploads/gallery/thumbnails/${coverPhoto.file_path}`;
      }
    } else if (photos.length > 0) {
      coverUrl = `/uploads/gallery/thumbnails/${photos[0].file_path}`;
    }

    const transformedPhotos = photos.map(p => ({
      id: p.id,
      album_id: p.album_id,
      image_url: `/uploads/gallery/${p.file_path}`,
      thumbnail_url: `/uploads/gallery/thumbnails/${p.file_path}`,
      caption: p.caption || '',
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    jsonResponse(res, 200, {
      album: {
        id: album.id,
        name: album.name,
        description: album.description || '',
        type: album.type,
        cover_photo_url: coverUrl,
        photo_count: transformedPhotos.length,
        created_at: album.created_at,
        updated_at: album.updated_at,
      },
      photos: transformedPhotos,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ALBUMS] Get album error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/profile/albums
 * Creates a new album for the authenticated user.
 */
export async function handleCreateAlbum(req, res, user) {
  try {
    const body = await parseBody(req);
    const { name, description, type } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse(res, 422, 'Album name is required');
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return errorResponse(res, 422, 'Album name must be less than 100 characters');
    }

    // Check for duplicate name for this user
    const existing = queryOne(
      'SELECT id FROM photo_albums WHERE user_id = ? AND name = ? COLLATE NOCASE',
      [user.sub, trimmedName]
    );
    if (existing) {
      return errorResponse(res, 409, 'An album with this name already exists');
    }

    // Validate type
    const albumType = type && ALBUM_TYPES.includes(type) ? type : 'general';
    
    // Only one Profile Pictures album allowed
    if (albumType === 'profile') {
      const existingProfileAlbum = queryOne(
        'SELECT id FROM photo_albums WHERE user_id = ? AND type = ?',
        [user.sub, 'profile']
      );
      if (existingProfileAlbum) {
        return errorResponse(res, 409, 'Profile Pictures album already exists');
      }
    }

    const albumId = crypto.randomBytes(16).toString('hex');
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    execute(
      'INSERT INTO photo_albums (id, user_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [albumId, user.sub, trimmedName, description?.trim() || '', albumType, timestamp, timestamp]
    );

    jsonResponse(res, 201, {
      album: {
        id: albumId,
        name: trimmedName,
        description: description?.trim() || '',
        type: albumType,
        cover_photo_url: null,
        photo_count: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });
  } catch (err) {
    console.error('[ALBUMS] Create album error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle PATCH /api/profile/albums/:id
 * Updates an album (rename, description, cover photo).
 */
export async function handleUpdateAlbum(req, res, user, params) {
  try {
    const album = queryOne(
      'SELECT * FROM photo_albums WHERE id = ?',
      [params.id]
    );

    if (!album) {
      return errorResponse(res, 404, 'Album not found');
    }

    if (album.user_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to modify this album');
    }

    const body = await parseBody(req);
    const { name, description, cover_photo_id } = body;

    let newName = album.name;
    let newDescription = album.description;
    let newCoverPhotoId = album.cover_photo_id;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        return errorResponse(res, 422, 'Album name cannot be empty');
      }
      const trimmedName = name.trim();
      if (trimmedName.length > 100) {
        return errorResponse(res, 422, 'Album name must be less than 100 characters');
      }
      // Check for duplicate name
      if (trimmedName !== album.name) {
        const existing = queryOne(
          'SELECT id FROM photo_albums WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?',
          [user.sub, trimmedName, params.id]
        );
        if (existing) {
          return errorResponse(res, 409, 'An album with this name already exists');
        }
      }
      newName = trimmedName;
    }

    if (description !== undefined) {
      newDescription = description?.trim() || '';
    }

    if (cover_photo_id !== undefined) {
      if (cover_photo_id === null || cover_photo_id === '') {
        newCoverPhotoId = null;
      } else {
        // Verify the photo belongs to this album
        const photo = queryOne(
          'SELECT id FROM profile_photos WHERE id = ? AND album_id = ?',
          [cover_photo_id, params.id]
        );
        if (!photo) {
          return errorResponse(res, 422, 'Invalid cover photo');
        }
        newCoverPhotoId = cover_photo_id;
      }
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    execute(
      'UPDATE photo_albums SET name = ?, description = ?, cover_photo_id = ?, updated_at = ? WHERE id = ?',
      [newName, newDescription, newCoverPhotoId, timestamp, params.id]
    );

    jsonResponse(res, 200, {
      album: {
        id: album.id,
        name: newName,
        description: newDescription,
        type: album.type,
        cover_photo_id: newCoverPhotoId,
        updated_at: timestamp,
      },
    });
  } catch (err) {
    console.error('[ALBUMS] Update album error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle DELETE /api/profile/albums/:id
 * Deletes an album and all its photos.
 */
export function handleDeleteAlbum(req, res, user, params) {
  try {
    const album = queryOne(
      'SELECT * FROM photo_albums WHERE id = ?',
      [params.id]
    );

    if (!album) {
      return errorResponse(res, 404, 'Album not found');
    }

    if (album.user_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to delete this album');
    }

    // Don't allow deleting Profile Pictures album
    if (album.type === 'profile') {
      return errorResponse(res, 400, 'Cannot delete the Profile Pictures album');
    }

    // Get all photos in the album to delete files
    const photos = queryAll(
      'SELECT file_path FROM profile_photos WHERE album_id = ?',
      [params.id]
    );

    // Delete photo files
    for (const photo of photos) {
      const filePath = resolve(galleryUploadDir, photo.file_path);
      const thumbnailPath = resolve(galleryThumbnailDir, photo.file_path);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
        if (existsSync(thumbnailPath)) unlinkSync(thumbnailPath);
      } catch (fileErr) {
        console.error('[ALBUMS] Failed to delete photo file:', fileErr.message);
      }
    }

    // Delete album (cascades to profile_photos via FK)
    execute('DELETE FROM photo_albums WHERE id = ?', [params.id]);

    jsonResponse(res, 200, { message: 'Album deleted successfully' });
  } catch (err) {
    console.error('[ALBUMS] Delete album error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/profiles/:username/photos
 * Returns photos, optionally filtered by album_id.
 */
export function handleGetPhotosWithAlbum(req, res, params) {
  try {
    const username = params.username ? params.username.toLowerCase() : '';

    const profile = queryOne(
      'SELECT user_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username = ?',
      [username]
    );

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const albumId = params.albumId || null;
    const limit = Math.min(parseInt(params.limit || '50', 10), 100);
    const offset = parseInt(params.offset || '0', 10);

    let photos;
    if (albumId) {
      // Verify album belongs to this user
      const album = queryOne(
        'SELECT id FROM photo_albums WHERE id = ? AND user_id = ?',
        [albumId, profile.user_id]
      );
      if (!album) {
        return errorResponse(res, 404, 'Album not found');
      }
      photos = queryAll(`
        SELECT
          id,
          profile_user_id,
          album_id,
          file_path,
          caption,
          created_at,
          updated_at,
          status
        FROM profile_photos
        WHERE album_id = ? AND status = 'active'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `, [albumId, limit, offset]);
    } else {
      photos = queryAll(`
        SELECT
          id,
          profile_user_id,
          album_id,
          file_path,
          caption,
          created_at,
          updated_at,
          status
        FROM profile_photos
        WHERE profile_user_id = ? AND status = 'active'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `, [profile.user_id, limit, offset]);
    }

    const transformed = photos.map(p => ({
      id: p.id,
      album_id: p.album_id,
      image_url: `/uploads/gallery/${p.file_path}`,
      thumbnail_url: `/uploads/gallery/thumbnails/${p.file_path}`,
      caption: p.caption || '',
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    jsonResponse(res, 200, {
      photos: transformed,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ALBUMS] Get photos with album error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/profile/profile-pictures-album
 * Returns the Profile Pictures album for the authenticated user.
 */
export function handleGetProfilePicturesAlbum(req, res, user) {
  try {
    const album = queryOne(
      'SELECT * FROM photo_albums WHERE user_id = ? AND type = ?',
      [user.sub, 'profile']
    );

    if (!album) {
      // Create it if it doesn't exist
      const albumId = crypto.randomBytes(16).toString('hex');
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      execute(
        'INSERT INTO photo_albums (id, user_id, name, description, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [albumId, user.sub, 'Profile Pictures', 'Your profile picture history', 'profile', timestamp, timestamp]
      );
      
      return jsonResponse(res, 200, {
        album: {
          id: albumId,
          name: 'Profile Pictures',
          description: 'Your profile picture history',
          type: 'profile',
          cover_photo_url: null,
          photo_count: 0,
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
    }

    const photoCount = queryOne(
      'SELECT COUNT(*) as count FROM profile_photos WHERE album_id = ? AND status = ?',
      [album.id, 'active']
    );

    let coverUrl = null;
    if (album.cover_photo_id) {
      const coverPhoto = queryOne(
        'SELECT file_path FROM profile_photos WHERE id = ?',
        [album.cover_photo_id]
      );
      if (coverPhoto) {
        coverUrl = `/uploads/gallery/thumbnails/${coverPhoto.file_path}`;
      }
    } else if (photoCount && photoCount.count > 0) {
      const newestPhoto = queryOne(
        'SELECT file_path FROM profile_photos WHERE album_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
        [album.id, 'active']
      );
      if (newestPhoto) {
        coverUrl = `/uploads/gallery/thumbnails/${newestPhoto.file_path}`;
      }
    }

    jsonResponse(res, 200, {
      album: {
        id: album.id,
        name: album.name,
        description: album.description || '',
        type: album.type,
        cover_photo_url: coverUrl,
        photo_count: photoCount?.count || 0,
        created_at: album.created_at,
        updated_at: album.updated_at,
      },
    });
  } catch (err) {
    console.error('[ALBUMS] Get profile pictures album error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}