/**
 * KomuniPH Lite - Profile
 * Profile routes
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { resolve, extname } from 'path';
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
    console.log('[PROFILE] Received file:', fieldname, info.filename, info.mimeType);
    
    if (fieldname !== 'photo') {
      file.resume();
      sendError(422, 'Field name must be "photo"');
      return;
    }

    const { filename, mimeType } = info;

    // Validate MIME type
    if (!config.upload.allowedMimeTypes.includes(mimeType)) {
      file.resume();
      sendError(422, 'Invalid file type. Allowed: JPEG, PNG, WebP');
      return;
    }

    // Validate file extension
    const ext = extname(filename || '').toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExtensions.includes(ext)) {
      file.resume();
      sendError(422, 'Invalid file extension. Allowed: .jpg, .jpeg, .png, .webp');
      return;
    }

    // Generate unique filename (always .webp after processing)
    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.webp`;
    const filePath = resolve(uploadDir, uniqueFilename);

    // Collect the file data
    const chunks = [];
    let fileSize = 0;

    file.on('data', (chunk) => {
      fileSize += chunk.length;
      if (fileSize > config.upload.maxFileSize) {
        file.resume();
        sendError(422, `File too large. Maximum size: ${config.upload.maxFileSize / 1024 / 1024}MB`);
        return;
      }
      chunks.push(chunk);
    });

    file.on('end', () => {
      console.log('[PROFILE] File received:', filename, fileSize, 'bytes');
      fileInfo = {
        filename,
        mimeType,
        uniqueFilename,
        filePath,
        data: Buffer.concat(chunks),
        fileSize
      };
    });
  });

  busboy.on('field', (name, value) => {
    console.log('[PROFILE] Field:', name, value);
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
      // Process image with sharp: resize + convert to WebP
      const targetPath = fileInfo.filePath;
      sharp(fileInfo.data)
        .resize({
          width: config.upload.maxWidth,
          height: config.upload.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: config.upload.webpQuality })
        .toBuffer()
        .then((optimizedBuffer) => {
          if (responseSent) return;

          // Write optimized WebP to disk
          writeFileSync(targetPath, optimizedBuffer);
          console.log('[PROFILE] Optimized image saved:', targetPath, optimizedBuffer.length, 'bytes');

          // Get old photo path before updating
          const oldProfile = queryOne(
            'SELECT profile_photo_url FROM profiles WHERE user_id = ?',
            [user.sub]
          );
          const oldPhotoPath = oldProfile?.profile_photo_url;

          // Update profile photo in database
          const photoUrl = `/uploads/profile/${fileInfo.uniqueFilename}`;
          execute(
            "UPDATE profiles SET profile_photo_url = ?, updated_at = datetime('now') WHERE user_id = ?",
            [photoUrl, user.sub]
          );

          // Delete old photo if it exists and is a local file
          if (oldPhotoPath && oldPhotoPath.startsWith('/uploads/profile/')) {
            const oldFilename = oldPhotoPath.replace('/uploads/profile/', '');
            const oldFilePath = resolve(uploadDir, oldFilename);
            try {
              if (existsSync(oldFilePath)) {
                unlinkSync(oldFilePath);
                console.log('[PROFILE] Deleted old photo:', oldFilePath);
              }
            } catch (e) {
              console.error('[PROFILE] Failed to delete old photo:', e);
            }
          }

          sendSuccess({
            message: 'Profile photo uploaded successfully',
            profile_photo_url: photoUrl,
          });
        })
        .catch((err) => {
          console.error('[PROFILE] Sharp processing error:', err);
          // Clean up any partial file
          try { if (existsSync(targetPath)) unlinkSync(targetPath); } catch (e) {}
          sendError(422, 'Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
        });
    }
  });

  req.pipe(busboy);
}