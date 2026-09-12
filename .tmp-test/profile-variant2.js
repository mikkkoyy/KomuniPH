/**
 * KomuniPH Lite - Profile
 * Profile routes
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import sharp from 'sharp';
import crypto from 'crypto';
import config from './config.js';
import { queryOne, execute } from './database.js';
import { jsonResponse, errorResponse } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure upload directory exists
const uploadDir = resolve(__dirname, '..', config.upload.profileDir);
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

// Startup diagnostic: confirm the upload directory is actually writable
try {
  const probePath = resolve(uploadDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[PROFILE] Upload directory writable:', uploadDir);
} catch (probeErr) {
  console.error('[PROFILE] Upload directory NOT writable:', uploadDir, probeErr.message);
}

/**
 * Handle GET /api/profile
 * Returns the authenticated user's own profile
 */
export function handleGetProfile(req, res, user) {
  try {
    const profile = queryOne(`
      SELECT
        p.id,
        p.user_id,
        u.username,
        p.display_name,
        p.real_name,
        p.alias,
        p.alias_enabled,
        p.bio,
        p.profile_photo_url,
        p.cover_photo_url,
        p.created_at,
        p.updated_at
      FROM profiles p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
    `, [user.sub]);

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    // Convert alias_enabled from integer to boolean
    profile.alias_enabled = Boolean(profile.alias_enabled);

    jsonResponse(res, 200, profile);
  } catch (err) {
    console.error('[PROFILE] Get profile error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/profile/:username
 * Returns a public profile by username
 */
export function handleGetPublicProfile(req, res, params) {
  try {
    const profile = queryOne(`
      SELECT
        p.id,
        p.user_id,
        u.username,
        p.display_name,
        p.real_name,
        p.alias,
        p.alias_enabled,
        p.bio,
        p.profile_photo_url,
        p.cover_photo_url,
        p.created_at,
        p.updated_at
      FROM profiles p
      JOIN users u ON p.user_id = u.id
      WHERE u.username = ?
    `, [params.username]);

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    // Convert alias_enabled from integer to boolean
    profile.alias_enabled = Boolean(profile.alias_enabled);

    jsonResponse(res, 200, profile);
  } catch (err) {
    console.error('[PROFILE] Get public profile error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/profile/photo
 * Upload a profile photo
 *
 * Pipeline:
 *   Profile UI -> <input type="file"> -> FormData -> api.uploadPhoto()
 *   -> POST /api/profile/photo -> Authentication -> Busboy multipart parsing
 *   -> file stream collected in memory -> complete buffer
 *   -> Sharp (validate via metadata, resize <= 1024x1024, WebP quality 80)
 *   -> uploads/profile/*.webp -> SQLite profile photo reference -> HTTP response
 *
 * Sharp only ever receives the COMPLETE buffer: the file stream is collected
 * into memory and processing starts from the Busboy 'finish' event, after the
 * entire multipart file stream has finished.
 */
export function handleUploadPhoto(req, res, user) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(res, 422, 'Content-Type must be multipart/form-data');
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: 1,
      fileSize: config.upload.maxFileSize,
    },
  });

  let responseSent = false;

  const sendError = (status, message) => {
    if (!responseSent) {
      responseSent = true;
      errorResponse(res, status, message);
    }
  };

  const sendSuccess = (data) => {
    if (!responseSent) {
      responseSent = true;
      jsonResponse(res, 200, data);
    }
  };

  // Store the file info for processing after busboy finishes
  let fileInfo = null;

  busboy.on('file', (fieldname, file, info) => {
    console.log('[PROFILE] Busboy received file:', {
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

    // Generate unique filename (always .webp after processing)
    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.webp`;
    const filePath = resolve(uploadDir, uniqueFilename);

    // Collect the file stream into memory until it is complete
    const chunks = [];
    let fileSize = 0;
    let tooLarge = false;

    file.on('data', (chunk) => {
      fileSize += chunk.length;
      if (fileSize > config.upload.maxFileSize) {
        tooLarge = true;
        file.resume();
        sendError(422, `File too large. Maximum size: ${config.upload.maxFileSize / 1024 / 1024}MB`);
        return;
      }
      chunks.push(chunk);
    });

    file.on('end', () => {
      if (tooLarge) {
        console.log('[PROFILE] File rejected for exceeding size limit:', filename, fileSize, 'bytes');
        return;
      }
      const data = Buffer.concat(chunks);
      console.log('[PROFILE] File stream complete:', {
        filename,
        mimeType,
        receivedBytes: fileSize,
        bufferBytes: data.length,
        bufferEmpty: data.length === 0,
      });
      fileInfo = {
        filename,
        mimeType,
        uniqueFilename,
        filePath,
        data,
        fileSize,
      };
    });

    file.on('error', (err) => {
      console.error('[PROFILE] File stream error:', err);
      sendError(500, 'Upload processing failed');
    });
  });

  busboy.on('field', (name) => {
    console.log('[PROFILE] Busboy field:', name);
  });

  busboy.on('error', (err) => {
    console.error('[PROFILE] Busboy error:', err);
    sendError(500, 'Upload processing failed');
  });

  busboy.on('finish', () => {
    console.log('[PROFILE] Busboy finished. File info:', fileInfo ? 'present' : 'null');

    if (!fileInfo && !responseSent) {
      sendError(422, 'No file uploaded');
      return;
    }

    if (fileInfo && !responseSent) {
      // Busboy has completely received the file stream; only now call Sharp.
      processPhotoUpload(fileInfo, user)
        .then((photoUrl) => {
          sendSuccess({
            message: 'Profile photo uploaded successfully',
            profile_photo_url: photoUrl,
          });
        })
        .catch((err) => {
          // Cleanup partial new file (if any) on failure. The existing photo
          // and database reference survive untouched.
          const targetPath = fileInfo.filePath;
          try {
            if (existsSync(targetPath)) {
              unlinkSync(targetPath);
              console.log('[PROFILE] Removed failed upload file:', targetPath);
            }
          } catch (cleanupErr) {
            console.error('[PROFILE] Cleanup failed:', cleanupErr);
          }
          const status = err.status || 422;
          const message = err.message || 'Failed to process image. Please upload a valid JPEG, PNG, or WebP image.';
          console.error('[PROFILE] Upload rejected (' + status + '):', message);
          sendError(status, message);
        });
    }
  });

  req.pipe(busboy);
}
/**
 * Validate the buffered upload with Sharp, resize + convert to WebP, write the
 * new file, update SQLite, and only then clean up the old profile photo.
 *
 * Replacement safety order:
 *   1. receive new upload
 *   2. validate image contents with Sharp (metadata)
 *   3. process (resize + WebP)
 *   4. write new WebP successfully
 *   5. update SQLite
 *   6. only then remove the old file
 *
 * On any failure the partial new file is removed, the existing profile photo
 * is kept, and the database reference is never corrupted.
 *
 * @returns {Promise<string>} new public photo URL (`/uploads/profile/<name>.webp`)
 */
async function processPhotoUpload(fileInfo, user) {
  const { filename, mimeType, uniqueFilename, filePath, data, fileSize } = fileInfo;

  // 0. Buffer sanity check — never process an empty stream
  if (!data || data.length === 0) {
    console.error('[PROFILE] Rejected empty file:', { filename, mimeType, bytes: fileSize });
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  // 1. Validate the ACTUAL image contents with Sharp.
  //    The real image data is authoritative; the browser MIME type is only a hint.
  let metadata;
  try {
    metadata = await sharp(data).metadata();
  } catch (metaErr) {
    console.error('[PROFILE] Sharp metadata FAILED (invalid image data):', metaErr.message);
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  const detectedFormat = String(metadata.format || '').toLowerCase();
  const validFormats = ['jpeg', 'jpg', 'png', 'webp'];
  console.log('[PROFILE] Detected image contents:', {
    filename,
    browserMime: mimeType,
    detectedFormat,
    width: metadata.width,
    height: metadata.height,
    bufferBytes: data.length,
  });

  if (!validFormats.includes(detectedFormat)) {
    console.error('[PROFILE] Rejected unsupported image format:', detectedFormat);
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  // 2. Resize (fit inside, no enlargement) + convert to WebP quality 80
  let optimizedBuffer;
  try {
    optimizedBuffer = await sharp(data)
      .resize({
        width: config.upload.maxWidth,
        height: config.upload.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: config.upload.webpQuality })
      .toBuffer();
  } catch (resizeErr) {
    console.error('[PROFILE] Sharp resize/convert FAILED:', resizeErr.message);
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  const outputMeta = { format: 'webp' }; // VARIANT2: output metadata() disabled for bisect
  console.log('[PROFILE] Optimized image:', {
    format: outputMeta.format,
    width: 0,
    height: 0,
    bytes: optimizedBuffer.length,
  });

  // 3. Write the new WebP (complete buffer)
  try {
    writeFileSync(filePath, optimizedBuffer);
    console.log('[PROFILE] Optimized image saved:', filePath, optimizedBuffer.length, 'bytes');
  } catch (writeErr) {
    console.error('[PROFILE] Failed to write optimized image:', writeErr.message);
    const err = new Error('Failed to save uploaded photo. Please try again.');
    err.status = 500;
    throw err;
  }

  // 4. Read the old photo reference BEFORE updating the database
  let oldPhotoPath = null;
  try {
    const oldProfile = queryOne(
      'SELECT profile_photo_url FROM profiles WHERE user_id = ?',
      [user.sub]
    );
    oldPhotoPath = oldProfile?.profile_photo_url || null;
  } catch (dbErr) {
    console.error('[PROFILE] Failed to query old photo:', dbErr.message);
    const err = new Error('Failed to save uploaded photo. Please try again.');
    err.status = 500;
    throw err;
  }

  // 5. Update the profile photo reference in SQLite
  const photoUrl = `/uploads/profile/${uniqueFilename}`;
  try {
    execute(
      "UPDATE profiles SET profile_photo_url = ?, updated_at = datetime('now') WHERE user_id = ?",
      [photoUrl, user.sub]
    );
    console.log('[PROFILE] Database updated for user', user.sub, '->', photoUrl);
  } catch (dbErr) {
    console.error('[PROFILE] Failed to update profile photo in database:', dbErr.message);
    const err = new Error('Failed to save uploaded photo. Please try again.');
    err.status = 500;
    throw err;
  }

  // 6. Only after the new photo is committed, remove the old local file
  if (oldPhotoPath && oldPhotoPath.startsWith('/uploads/profile/')) {
    const oldFilename = oldPhotoPath.replace('/uploads/profile/', '');
    if (oldFilename !== uniqueFilename) {
      const oldFilePath = resolve(uploadDir, oldFilename);
      try {
        if (existsSync(oldFilePath)) {
          unlinkSync(oldFilePath);
          console.log('[PROFILE] Deleted old photo:', oldFilePath);
        }
      } catch (delErr) {
        console.error('[PROFILE] Failed to delete old photo:', delErr);
      }
    }
  }

  return photoUrl;
}
