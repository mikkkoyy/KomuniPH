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
import { jsonResponse, errorResponse, parseBody } from './utils.js';
import { seedDefaultTheme } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure upload directories exist
const uploadDir = resolve(__dirname, '..', config.upload.profileDir);
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

const backgroundUploadDir = resolve(__dirname, '..', config.upload.backgroundDir);
if (!existsSync(backgroundUploadDir)) {
  mkdirSync(backgroundUploadDir, { recursive: true });
}

// Startup diagnostics
try {
  const probePath = resolve(uploadDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[PROFILE] Upload directory writable:', uploadDir);
} catch (probeErr) {
  console.error('[PROFILE] Upload directory NOT writable:', uploadDir, probeErr.message);
}

try {
  const probePath = resolve(backgroundUploadDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[PROFILE] Background upload directory writable:', backgroundUploadDir);
} catch (probeErr) {
  console.error('[PROFILE] Background upload directory NOT writable:', backgroundUploadDir, probeErr.message);
}

const ALLOWED_BACKGROUND_POSITIONS = new Set([
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top center', 'top right',
  'center left', 'center center', 'center right',
  'bottom left', 'bottom center', 'bottom right'
]);

const ALLOWED_BACKGROUND_SIZES = new Set(['cover', 'contain', 'auto']);
const ALLOWED_BACKGROUND_REPEATS = new Set(['no-repeat', 'repeat', 'repeat-x', 'repeat-y']);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isValidHexColor(value) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

function validateThemeConfig(body) {
  const errors = [];
  const allowedFields = new Set([
    'backgroundImage', 'backgroundPosition', 'backgroundRepeat', 'backgroundSize',
    'backgroundGradient', 'backgroundColor', 'textColor', 'mutedTextColor',
    'accentColor', 'cardBackground', 'cardOpacity', 'cardBorderColor', 'cardBorderRadius'
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      errors.push(`Unknown theme field: ${key}`);
    }
  }

  if (body.backgroundImage !== undefined && body.backgroundImage !== null && typeof body.backgroundImage !== 'string') {
    errors.push('backgroundImage must be a string or null');
  }
  if (body.backgroundPosition !== undefined && body.backgroundPosition !== null && !ALLOWED_BACKGROUND_POSITIONS.has(body.backgroundPosition)) {
    errors.push('backgroundPosition must be a valid position value');
  }
  if (body.backgroundRepeat !== undefined && body.backgroundRepeat !== null && !ALLOWED_BACKGROUND_REPEATS.has(body.backgroundRepeat)) {
    errors.push('backgroundRepeat must be a valid repeat value');
  }
  if (body.backgroundSize !== undefined && body.backgroundSize !== null && !ALLOWED_BACKGROUND_SIZES.has(body.backgroundSize)) {
    errors.push('backgroundSize must be a valid size value');
  }
  if (body.backgroundGradient !== undefined && body.backgroundGradient !== null) {
    if (typeof body.backgroundGradient !== 'string' || !/^linear-gradient\(/i.test(body.backgroundGradient)) {
      errors.push('backgroundGradient must be a linear-gradient string or null');
    }
  }
  if (body.backgroundColor !== undefined && body.backgroundColor !== null && !isValidHexColor(body.backgroundColor)) {
    errors.push('backgroundColor must be a valid hex color (#RRGGBB) or null');
  }
  if (body.textColor !== undefined && body.textColor !== null && !isValidHexColor(body.textColor)) {
    errors.push('textColor must be a valid hex color (#RRGGBB) or null');
  }
  if (body.mutedTextColor !== undefined && body.mutedTextColor !== null && !isValidHexColor(body.mutedTextColor)) {
    errors.push('mutedTextColor must be a valid hex color (#RRGGBB) or null');
  }
  if (body.accentColor !== undefined && body.accentColor !== null && !isValidHexColor(body.accentColor)) {
    errors.push('accentColor must be a valid hex color (#RRGGBB) or null');
  }
  if (body.cardBackground !== undefined && body.cardBackground !== null && !isValidHexColor(body.cardBackground)) {
    errors.push('cardBackground must be a valid hex color (#RRGGBB) or null');
  }
  if (body.cardOpacity !== undefined && body.cardOpacity !== null) {
    if (typeof body.cardOpacity !== 'number' || body.cardOpacity < 0 || body.cardOpacity > 1) {
      errors.push('cardOpacity must be a number between 0 and 1');
    }
  }
  if (body.cardBorderColor !== undefined && body.cardBorderColor !== null && !isValidHexColor(body.cardBorderColor)) {
    errors.push('cardBorderColor must be a valid hex color (#RRGGBB) or null');
  }
  if (body.cardBorderRadius !== undefined && body.cardBorderRadius !== null) {
    if (typeof body.cardBorderRadius !== 'number' || body.cardBorderRadius < 0 || body.cardBorderRadius > 100) {
      errors.push('cardBorderRadius must be a number between 0 and 100');
    }
  }

  return errors;
}

/**
 * Shared profile SELECT columns (own + public profile shape).
 */
const PROFILE_SELECT = `
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
    p.theme_id,
    p.custom_theme_config,
    p.created_at,
    p.updated_at
  FROM profiles p
  JOIN users u ON p.user_id = u.id
`;

/**
 * Build theme object for a profile row, merging base theme with custom config.
 */
function buildTheme(profile) {
  if (!profile || !profile.theme_id) return null;

  const theme = queryOne(
    'SELECT id, name, type, is_free, config FROM profile_themes WHERE id = ?',
    [profile.theme_id]
  );
  if (!theme) return null;

  let baseConfig = {};
  try {
    baseConfig = theme.config ? JSON.parse(theme.config) : {};
  } catch (e) {
    baseConfig = {};
  }

  let customConfig = {};
  if (profile.custom_theme_config) {
    try {
      customConfig = JSON.parse(profile.custom_theme_config);
    } catch (e) {
      customConfig = {};
    }
  }

  const mergedConfig = { ...baseConfig, ...customConfig };

  return {
    id: theme.id,
    name: theme.name,
    type: theme.type,
    is_free: Boolean(theme.is_free),
    config: mergedConfig,
    custom: customConfig
  };
}

/**
 * Fetch a profile row by user id (same shape as GET /api/profile).
 */
function getProfileByUserId(userId) {
  const profile = queryOne(`${PROFILE_SELECT} WHERE p.user_id = ?`, [userId]);
  if (profile) {
    profile.alias_enabled = Boolean(profile.alias_enabled);
    profile.theme = buildTheme(profile);
  }
  return profile;
}
/**
 * Alias policy (FEED-07): trimmed, predictable characters, normalized as-is.
 * Allowed: letters, numbers, underscore, hyphen, dot; 1-50 chars.
 * Uniqueness is enforced in application code (case-insensitive) since the
 * schema does not declare a UNIQUE constraint on profiles.alias.
 */
export function handleGetProfile(req, res, user) {
  try {
    const profile = getProfileByUserId(user.sub);

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
        p.theme_id,
        p.custom_theme_config,
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
    profile.theme = buildTheme(profile);

    jsonResponse(res, 200, profile);
  } catch (err) {
    console.error('[PROFILE] Get public profile error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
/**
 * Validate alias: letters, numbers, underscore, dot, hyphen; max 50 chars.
 */
function isValidAlias(alias) {
  return /^[A-Za-z0-9_.-]{1,50}$/.test(alias);
}
/**
 * Handle PATCH /api/profile
 * Update the authenticated user's own profile (display_name, bio, alias).
 */
export async function handleUpdateProfile(req, res, user) {
  try {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return errorResponse(res, 400, 'Invalid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(res, 422, 'Profile update data is required');
    }

    const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'display_name');
    const hasBio = Object.prototype.hasOwnProperty.call(body, 'bio');
    const hasAlias = Object.prototype.hasOwnProperty.call(body, 'alias');

    if (!hasDisplayName && !hasBio && !hasAlias) {
      return errorResponse(res, 422, 'At least one of display_name, bio, or alias is required');
    }

    const existing = queryOne('SELECT * FROM profiles WHERE user_id = ?', [user.sub]);
    if (!existing) {
      return errorResponse(res, 404, 'Profile not found');
    }

    let displayName = existing.display_name;
    let bio = existing.bio;
    let alias = existing.alias;
    let customThemeConfig = existing.custom_theme_config;

    // display_name: required when provided, trimmed, 1-100 chars
    if (hasDisplayName) {
      if (typeof body.display_name !== 'string') {
        return errorResponse(res, 422, 'Display name must be a string');
      }
      const trimmed = body.display_name.trim();
      if (!trimmed) {
        return errorResponse(res, 422, 'Display name is required');
      }
      if (trimmed.length > 100) {
        return errorResponse(res, 422, 'Display name must be less than 100 characters');
      }
      displayName = trimmed;
    }

    // bio: optional, string or null, trimmed, max 500 chars (empty -> NULL)
    if (hasBio) {
      if (body.bio !== null && typeof body.bio !== 'string') {
        return errorResponse(res, 422, 'Bio must be a string');
      }
      const trimmed = body.bio === null ? '' : body.bio.trim();
      if (trimmed.length > 500) {
        return errorResponse(res, 422, 'Bio must be less than 500 characters');
      }
      bio = trimmed ? trimmed : null;
    }

    // alias: required when provided per conservative policy, trimmed, 1-50 chars,
    // predictable charset, unique across profiles (excluding own record)
    if (hasAlias) {
      if (typeof body.alias !== 'string') {
        return errorResponse(res, 422, 'Alias must be a string');
      }
      const trimmed = body.alias.trim();
      if (!trimmed) {
        return errorResponse(res, 422, 'Alias is required');
      }
      if (trimmed.length > 50) {
        return errorResponse(res, 422, 'Alias must be less than 50 characters');
      }
      if (!isValidAlias(trimmed)) {
        return errorResponse(res, 422, 'Alias may only contain letters, numbers, underscore, dot, and hyphen');
      }
      const conflict = queryOne(
        'SELECT user_id FROM profiles WHERE alias = ? COLLATE NOCASE AND user_id != ?',
        [trimmed, user.sub]
      );
      if (conflict) {
        return errorResponse(res, 409, 'Alias is already taken');
      }
      alias = trimmed;
    }

    execute(
      "UPDATE profiles SET display_name = ?, bio = ?, alias = ?, custom_theme_config = ?, updated_at = datetime('now') WHERE user_id = ?",
      [displayName, bio, alias, customThemeConfig, user.sub]
    );

    const updated = getProfileByUserId(user.sub);
    if (!updated) {
      return errorResponse(res, 404, 'Profile not found');
    }
    return jsonResponse(res, 200, updated);
  } catch (err) {
    console.error('[PROFILE] Update profile error:', err);
    return errorResponse(res, 500, 'Internal server error');
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

  const outputMeta = await sharp(optimizedBuffer).metadata();
  console.log('[PROFILE] Optimized image:', {
    format: outputMeta.format,
    width: outputMeta.width,
    height: outputMeta.height,
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

  // 6. Only after the new photo is committed, remove the old local file.
  //    On Windows, unlink can transiently fail with EBUSY/EPERM when the file
  //    is briefly locked (AV scans, preview handlers, etc.), so retry a few
  //    times before giving up. A failure here only leaves a stale file; the
  //    new photo and the database reference remain consistent.
  if (oldPhotoPath && oldPhotoPath.startsWith('/uploads/profile/')) {
    const oldFilename = oldPhotoPath.replace('/uploads/profile/', '');
    if (oldFilename !== uniqueFilename) {
      const oldFilePath = resolve(uploadDir, oldFilename);
      await removeOldPhotoWithRetry(oldFilePath);
    }
  }

  return photoUrl;
}

/**
 * Handle PATCH /api/profile/theme
 * Update the authenticated user's theme customization.
 */
export async function handleUpdateTheme(req, res, user) {
  try {
    let body;
    try {
      body = await parseBody(req);
    } catch (e) {
      return errorResponse(res, 400, 'Invalid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(res, 422, 'Theme data is required');
    }

    const validationErrors = validateThemeConfig(body);
    if (validationErrors.length > 0) {
      return errorResponse(res, 422, validationErrors.join('; '));
    }

    const existing = queryOne('SELECT * FROM profiles WHERE user_id = ?', [user.sub]);
    if (!existing) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const currentCustom = existing.custom_theme_config ? JSON.parse(existing.custom_theme_config) : {};
    const mergedCustom = { ...currentCustom, ...body };

    // Remove null values so they revert to base theme
    for (const key of Object.keys(mergedCustom)) {
      if (mergedCustom[key] === null || mergedCustom[key] === undefined) {
        delete mergedCustom[key];
      }
    }

    const customThemeConfig = Object.keys(mergedCustom).length > 0 ? JSON.stringify(mergedCustom) : null;

    execute(
      "UPDATE profiles SET custom_theme_config = ?, updated_at = datetime('now') WHERE user_id = ?",
      [customThemeConfig, user.sub]
    );

    const updated = getProfileByUserId(user.sub);
    if (!updated) {
      return errorResponse(res, 404, 'Profile not found');
    }
    return jsonResponse(res, 200, updated);
  } catch (err) {
    console.error('[PROFILE] Update theme error:', err);
    return errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/profile/background
 * Upload a profile background image.
 */
export function handleUploadBackground(req, res, user) {
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

  let fileInfo = null;

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'background') {
      file.resume();
      sendError(422, 'Field name must be "background"');
      return;
    }

    const { filename, mimeType } = info;
    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.webp`;
    const filePath = resolve(backgroundUploadDir, uniqueFilename);

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
        console.log('[PROFILE] Background rejected for exceeding size limit:', filename, fileSize, 'bytes');
        return;
      }
      const data = Buffer.concat(chunks);
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
      console.error('[PROFILE] Background file stream error:', err);
      sendError(500, 'Upload processing failed');
    });
  });

  busboy.on('finish', () => {
    if (!fileInfo && !responseSent) {
      sendError(422, 'No file uploaded');
      return;
    }

    if (fileInfo && !responseSent) {
      processBackgroundUpload(fileInfo, user)
        .then((backgroundUrl) => {
          sendSuccess({
            message: 'Background uploaded successfully',
            background_url: backgroundUrl,
          });
        })
        .catch((err) => {
          const targetPath = fileInfo.filePath;
          try {
            if (existsSync(targetPath)) {
              unlinkSync(targetPath);
              console.log('[PROFILE] Removed failed background upload:', targetPath);
            }
          } catch (cleanupErr) {
            console.error('[PROFILE] Background cleanup failed:', cleanupErr);
          }
          const status = err.status || 422;
          const message = err.message || 'Failed to process background image.';
          console.error('[PROFILE] Background upload rejected (' + status + '):', message);
          sendError(status, message);
        });
    }
  });

  req.pipe(busboy);
}

/**
 * Validate and process background upload.
 */
async function processBackgroundUpload(fileInfo, user) {
  const { filename, mimeType, uniqueFilename, filePath, data, fileSize } = fileInfo;

  if (!data || data.length === 0) {
    const err = new Error('Failed to process background image. Please upload a valid image.');
    err.status = 422;
    throw err;
  }

  let metadata;
  try {
    metadata = await sharp(data).metadata();
  } catch (metaErr) {
    const err = new Error('Failed to process background image. Please upload a valid image.');
    err.status = 422;
    throw err;
  }

  const detectedFormat = String(metadata.format || '').toLowerCase();
  const validFormats = ['jpeg', 'jpg', 'png', 'webp'];
  if (!validFormats.includes(detectedFormat)) {
    const err = new Error('Failed to process background image. Please upload a valid JPEG, PNG, or WebP image.');
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
    const err = new Error('Failed to process background image. Please upload a valid image.');
    err.status = 422;
    throw err;
  }

  try {
    writeFileSync(filePath, optimizedBuffer);
    console.log('[PROFILE] Background image saved:', filePath, optimizedBuffer.length, 'bytes');
  } catch (writeErr) {
    const err = new Error('Failed to save background image. Please try again.');
    err.status = 500;
    throw err;
  }

  const backgroundUrl = `/uploads/backgrounds/${uniqueFilename}`;

  // Update profile with background URL in custom_theme_config
  const existing = queryOne('SELECT custom_theme_config FROM profiles WHERE user_id = ?', [user.sub]);
  let currentCustom = {};
  if (existing?.custom_theme_config) {
    try {
      currentCustom = JSON.parse(existing.custom_theme_config);
    } catch (e) {
      currentCustom = {};
    }
  }
  currentCustom.backgroundImage = backgroundUrl;

  execute(
    "UPDATE profiles SET custom_theme_config = ?, updated_at = datetime('now') WHERE user_id = ?",
    [JSON.stringify(currentCustom), user.sub]
  );

  return backgroundUrl;
}

/**
 * Delete an old upload file, retrying a few times on transient Windows locks.
 * @returns {Promise<boolean>} true when the file is gone
 */
async function removeOldPhotoWithRetry(oldFilePath) {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (existsSync(oldFilePath)) {
        unlinkSync(oldFilePath);
      }
      console.log('[PROFILE] Deleted old photo:', oldFilePath);
      return true;
    } catch (delErr) {
      if ((delErr.code === 'EBUSY' || delErr.code === 'EPERM') && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      console.error('[PROFILE] Failed to delete old photo after', attempt, 'attempt(s):', delErr.message);
      return false;
    }
  }
  return false;
}
