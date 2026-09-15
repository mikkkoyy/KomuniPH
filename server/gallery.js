/**
 * KomuniPH Lite - Photo Gallery
 * Photo Gallery API routes
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import sharp from 'sharp';
import crypto from 'crypto';
import config from './config.js';
import { queryOne, queryAll, execute } from './database.js';
import { jsonResponse, errorResponse } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure gallery upload directory exists
const galleryUploadDir = resolve(__dirname, '..', 'uploads/gallery');
if (!existsSync(galleryUploadDir)) {
  mkdirSync(galleryUploadDir, { recursive: true });
}

const galleryThumbnailDir = resolve(__dirname, '..', 'uploads/gallery/thumbnails');
if (!existsSync(galleryThumbnailDir)) {
  mkdirSync(galleryThumbnailDir, { recursive: true });
}

// Startup diagnostics
try {
  const probePath = resolve(galleryUploadDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[GALLERY] Upload directory writable:', galleryUploadDir);
} catch (probeErr) {
  console.error('[GALLERY] Upload directory NOT writable:', galleryUploadDir, probeErr.message);
}

try {
  const probePath = resolve(galleryThumbnailDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[GALLERY] Thumbnail directory writable:', galleryThumbnailDir);
} catch (probeErr) {
  console.error('[GALLERY] Thumbnail directory NOT writable:', galleryThumbnailDir, probeErr.message);
}

const MAX_FILE_SIZE = config.upload.maxFileSize;
const VALID_FORMATS = ['jpeg', 'jpg', 'png', 'webp'];
const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_HEIGHT = 400;

/**
 * Handle GET /api/profiles/:username/photos
 * Returns active photos for a profile by username (public, no auth required).
 */
export function handleGetPhotos(req, res, params) {
  try {
    const username = params.username ? params.username.toLowerCase() : '';

    const profile = queryOne(
      'SELECT user_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username = ?',
      [username]
    );

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
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
      WHERE profile_user_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [profile.user_id, limit, offset]);

    const transformed = photos.map(p => ({
      id: p.id,
      album_id: p.album_id || null,
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
    console.error('[GALLERY] Get photos error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/profile/photos
 * Upload one or multiple photos to the authenticated user's gallery.
 * Supports optional album_id field to assign photos to a specific album.
 */
export function handleUploadPhoto(req, res, user) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(res, 422, 'Content-Type must be multipart/form-data');
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: 20, // Allow multiple files
      fileSize: MAX_FILE_SIZE,
    },
  });

  let responseSent = false;
  let albumId = null;

  const sendError = (status, message) => {
    if (!responseSent) {
      responseSent = true;
      errorResponse(res, status, message);
    }
  };

  const sendSuccess = (data) => {
    if (!responseSent) {
      responseSent = true;
      jsonResponse(res, 201, data);
    }
  };

  const fileQueue = [];

  busboy.on('file', (fieldname, file, info) => {
    console.log('[GALLERY] Busboy received file:', {
      fieldname,
      filename: info.filename,
      mimeType: info.mimeType,
    });

    if (fieldname !== 'photo') {
      file.resume();
      sendError(422, 'Field name must be "photo"');
      return;
    }

    const { filename, mimeType } = info;
    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.webp`;
    const filePath = resolve(galleryUploadDir, uniqueFilename);
    const thumbnailPath = resolve(galleryThumbnailDir, uniqueFilename);

    const chunks = [];
    let fileSize = 0;
    let tooLarge = false;

    file.on('data', (chunk) => {
      fileSize += chunk.length;
      if (fileSize > MAX_FILE_SIZE) {
        tooLarge = true;
        file.resume();
        sendError(422, `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        return;
      }
      chunks.push(chunk);
    });

    file.on('end', () => {
      if (tooLarge) {
        console.log('[GALLERY] File rejected for exceeding size limit:', filename, fileSize, 'bytes');
        return;
      }
      const data = Buffer.concat(chunks);
      console.log('[GALLERY] File stream complete:', {
        filename,
        mimeType,
        receivedBytes: fileSize,
        bufferBytes: data.length,
        bufferEmpty: data.length === 0,
      });
      fileQueue.push({
        filename,
        mimeType,
        uniqueFilename,
        filePath,
        thumbnailPath,
        data,
        fileSize,
      });
    });

    file.on('error', (err) => {
      console.error('[GALLERY] File stream error:', err);
      sendError(500, 'Upload processing failed');
    });
  });

  busboy.on('field', (name, val) => {
    console.log('[GALLERY] Busboy field:', name, val);
    if (name === 'album_id') {
      albumId = val;
    }
  });

  busboy.on('error', (err) => {
    console.error('[GALLERY] Busboy error:', err);
    sendError(500, 'Upload processing failed');
  });

  busboy.on('finish', async () => {
    console.log('[GALLERY] Busboy finished. Files in queue:', fileQueue.length);

    if (fileQueue.length === 0 && !responseSent) {
      sendError(422, 'No files uploaded');
      return;
    }

    if (!responseSent) {
      const results = [];
      const errors = [];

      for (const fileInfo of fileQueue) {
        try {
          const result = await processPhotoUpload(fileInfo, user, albumId);
          results.push({ success: true, photo: result });
        } catch (err) {
          const targetPath = fileInfo.filePath;
          const thumbPath = fileInfo.thumbnailPath;
          try {
            if (existsSync(targetPath)) {
              unlinkSync(targetPath);
              console.log('[GALLERY] Removed failed upload file:', targetPath);
            }
            if (existsSync(thumbPath)) {
              unlinkSync(thumbPath);
              console.log('[GALLERY] Removed failed thumbnail:', thumbPath);
            }
          } catch (cleanupErr) {
            console.error('[GALLERY] Cleanup failed:', cleanupErr);
          }
          errors.push({ filename: fileInfo.filename, error: err.message || 'Upload failed' });
        }
      }

      sendSuccess({
        message: `${results.length} photo(s) uploaded successfully${errors.length ? `, ${errors.length} failed` : ''}`,
        photos: results.map(r => r.photo),
        errors: errors.length > 0 ? errors : undefined,
      });
    }
  });

  req.pipe(busboy);
}

/**
 * Validate the buffered upload with Sharp, resize + convert to WebP,
 * generate thumbnail, write files, update SQLite.
 */
async function processPhotoUpload(fileInfo, user, albumId = null) {
  const { filename, mimeType, uniqueFilename, filePath, thumbnailPath, data, fileSize } = fileInfo;

  if (!data || data.length === 0) {
    console.error('[GALLERY] Rejected empty file:', { filename, mimeType, bytes: fileSize });
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  let metadata;
  try {
    metadata = await sharp(data).metadata();
  } catch (metaErr) {
    console.error('[GALLERY] Sharp metadata FAILED (invalid image data):', metaErr.message);
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  const detectedFormat = String(metadata.format || '').toLowerCase();
  console.log('[GALLERY] Detected image contents:', {
    filename,
    browserMime: mimeType,
    detectedFormat,
    width: metadata.width,
    height: metadata.height,
    bufferBytes: data.length,
  });

  if (!VALID_FORMATS.includes(detectedFormat)) {
    console.error('[GALLERY] Rejected unsupported image format:', detectedFormat);
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  let optimizedBuffer;
  try {
    optimizedBuffer = await sharp(data)
      .resize({
        width: 1920,
        height: 1080,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: config.upload.webpQuality })
      .toBuffer();
  } catch (resizeErr) {
    console.error('[GALLERY] Sharp resize/convert FAILED:', resizeErr.message);
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  let thumbnailBuffer;
  try {
    thumbnailBuffer = await sharp(data)
      .resize({
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        fit: 'cover',
      })
      .webp({ quality: 70 })
      .toBuffer();
  } catch (thumbErr) {
    console.error('[GALLERY] Sharp thumbnail FAILED:', thumbErr.message);
    const err = new Error('Failed to generate thumbnail.');
    err.status = 422;
    throw err;
  }

  try {
    writeFileSync(filePath, optimizedBuffer);
    writeFileSync(thumbnailPath, thumbnailBuffer);
    console.log('[GALLERY] Optimized image saved:', filePath, optimizedBuffer.length, 'bytes');
    console.log('[GALLERY] Thumbnail saved:', thumbnailPath, thumbnailBuffer.length, 'bytes');
  } catch (writeErr) {
    console.error('[GALLERY] Failed to write optimized image:', writeErr.message);
    const err = new Error('Failed to save uploaded photo. Please try again.');
    err.status = 500;
    throw err;
  }

  const photoId = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Validate album_id if provided
  let validatedAlbumId = null;
  if (albumId) {
    const album = queryOne(
      'SELECT id FROM photo_albums WHERE id = ? AND user_id = ?',
      [albumId, user.sub]
    );
    if (album) {
      validatedAlbumId = albumId;
    }
  }

  try {
    execute(
      'INSERT INTO profile_photos (id, profile_user_id, album_id, file_path, caption, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [photoId, user.sub, validatedAlbumId, uniqueFilename, '', timestamp, timestamp, 'active']
    );
    console.log('[GALLERY] Database record created for user', user.sub, '->', uniqueFilename, validatedAlbumId ? `in album ${validatedAlbumId}` : '');
  } catch (dbErr) {
    console.error('[GALLERY] Failed to insert photo record:', dbErr.message);
    const err = new Error('Failed to save uploaded photo. Please try again.');
    err.status = 500;
    throw err;
  }

  return {
    id: photoId,
    album_id: validatedAlbumId,
    image_url: `/uploads/gallery/${uniqueFilename}`,
    thumbnail_url: `/uploads/gallery/thumbnails/${uniqueFilename}`,
    caption: '',
    created_at: timestamp,
  };
}

/**
 * Handle DELETE /api/profile/photos/:id
 * Deletes a photo from the authenticated user's gallery (owner only).
 */
export function handleDeletePhoto(req, res, user, params) {
  try {
    const photo = queryOne(
      'SELECT * FROM profile_photos WHERE id = ?',
      [params.id]
    );

    if (!photo) {
      return errorResponse(res, 404, 'Photo not found');
    }

    if (photo.profile_user_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to delete this photo');
    }

    const filePath = resolve(galleryUploadDir, photo.file_path);
    const thumbnailPath = resolve(galleryThumbnailDir, photo.file_path);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        console.log('[GALLERY] Deleted photo file:', filePath);
      }
    } catch (fileErr) {
      console.error('[GALLERY] Failed to delete photo file:', fileErr.message);
    }

    try {
      if (existsSync(thumbnailPath)) {
        unlinkSync(thumbnailPath);
        console.log('[GALLERY] Deleted thumbnail file:', thumbnailPath);
      }
    } catch (thumbErr) {
      console.error('[GALLERY] Failed to delete thumbnail file:', thumbErr.message);
    }

    execute('DELETE FROM profile_photos WHERE id = ?', [params.id]);

    jsonResponse(res, 200, { message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('[GALLERY] Delete photo error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/profile/photos
 * Returns photos for the authenticated user's own profile (including private/hidden).
 */
export function handleGetOwnPhotos(req, res, user) {
  try {
    const limit = Math.min(parseInt(req.url.split('limit=')[1]?.split('&')[0] || '50', 10), 100);
    const offset = parseInt(req.url.split('offset=')[1]?.split('&')[0] || '0', 10);

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
      WHERE profile_user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [user.sub, limit, offset]);

    const transformed = photos.map(p => ({
      id: p.id,
      album_id: p.album_id || null,
      image_url: `/uploads/gallery/${p.file_path}`,
      thumbnail_url: `/uploads/gallery/thumbnails/${p.file_path}`,
      caption: p.caption || '',
      created_at: p.created_at,
      updated_at: p.updated_at,
      status: p.status,
    }));

    jsonResponse(res, 200, {
      photos: transformed,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[GALLERY] Get own photos error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}