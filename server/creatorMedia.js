/**
 * KomuniPH Lite - Creator Media Upload (CREATOR-06)
 *
 * Local image upload for Creator Studio image/sticker components. Reuses the
 * exact pipeline conventions of the existing profile/gallery/background
 * uploaders (Busboy multipart → complete buffered stream → Sharp content
 * validation → generated safe filename), writing into a separate
 * uploads/creator/ directory so studio media never mixes with profile or
 * gallery uploads.
 *
 * Security (all server-side, never trusting client filename/MIME alone):
 *   - authenticated ownership (route requires auth; files are namespaced by
 *     generated names, never user input)
 *   - actual file content validated with Sharp metadata; only
 *     jpeg/jpg/png/webp content accepted (GIF and everything else rejected —
 *     the existing image model has no safe GIF contract)
 *   - config max file size enforced on the stream
 *   - generated `<random>.webp` filename; resolve() + prefix check prevents
 *     path traversal
 *   - output always re-encoded WebP (no SVG/HTML/JS/executables can survive)
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import sharp from 'sharp';
import crypto from 'crypto';
import config from './config.js';
import { jsonResponse, errorResponse } from './utils.js';
import { execute } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const creatorUploadDir = resolve(__dirname, '..', config.upload.creatorDir);
if (!existsSync(creatorUploadDir)) {
  mkdirSync(creatorUploadDir, { recursive: true });
}

try {
  const probePath = resolve(creatorUploadDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[CREATOR-MEDIA] Upload directory writable:', creatorUploadDir);
} catch (probeErr) {
  console.error('[CREATOR-MEDIA] Upload directory NOT writable:', creatorUploadDir, probeErr.message);
}

const VALID_CONTENT_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp']);

/**
 * Handle POST /api/creator/media
 * Multipart field name must be "image". Returns the application URL that can
 * be stored directly in a design component's imageUrl config.
 */
export function handleUploadCreatorMedia(req, res, user) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(res, 422, 'Content-Type must be multipart/form-data');
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: config.upload.maxFileSize },
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
      jsonResponse(res, 201, data);
    }
  };

  let fileInfo = null;

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'image') {
      file.resume();
      sendError(422, 'Field name must be "image"');
      return;
    }

    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.webp`;
    const filePath = resolve(creatorUploadDir, uniqueFilename);

    // Path traversal guard: the resolved target must stay inside uploads/creator.
    if (!filePath.startsWith(creatorUploadDir)) {
      file.resume();
      sendError(422, 'Invalid upload target');
      return;
    }

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
      if (tooLarge) return;
      fileInfo = { uniqueFilename, filePath, data: Buffer.concat(chunks), fileSize };
    });

    file.on('error', () => sendError(500, 'Upload processing failed'));
  });

  busboy.on('error', () => sendError(500, 'Upload processing failed'));

  busboy.on('finish', () => {
    if (!fileInfo && !responseSent) {
      sendError(422, 'No file uploaded');
      return;
    }
    if (fileInfo && !responseSent) {
      processCreatorUpload(fileInfo, user.sub)
        .then((result) => sendSuccess(result))
        .catch((err) => {
          try {
            if (existsSync(fileInfo.filePath)) unlinkSync(fileInfo.filePath);
          } catch { /* best-effort cleanup */ }
          sendError(err.status || 422, err.message || 'Failed to process image.');
        });
    }
  });

  req.pipe(busboy);
}

/**
 * Validate the COMPLETE buffered upload with Sharp (content is
 * authoritative, not the browser MIME type), resize inside creator bounds,
 * convert to WebP, write the generated file, and record a creator_media row
 * (CREATOR-16) so the upload has an owner and can back a library reference.
 */
async function processCreatorUpload(fileInfo, userId) {
  const { uniqueFilename, filePath, data } = fileInfo;

  if (!data || data.length === 0) {
    const err = new Error('Empty file. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  let metadata;
  try {
    metadata = await sharp(data).metadata();
  } catch {
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  const detectedFormat = String(metadata.format || '').toLowerCase();
  if (!VALID_CONTENT_FORMATS.has(detectedFormat)) {
    const err = new Error(`Unsupported image format "${detectedFormat || 'unknown'}". Use JPG, PNG, or WebP.`);
    err.status = 422;
    throw err;
  }

  let optimizedBuffer;
  try {
    optimizedBuffer = await sharp(data)
      .resize({
        width: config.upload.creatorMaxWidth,
        height: config.upload.creatorMaxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: config.upload.webpQuality })
      .toBuffer();
  } catch {
    const err = new Error('Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
    err.status = 422;
    throw err;
  }

  try {
    writeFileSync(filePath, optimizedBuffer);
  } catch {
    const err = new Error('Failed to save uploaded image. Please try again.');
    err.status = 500;
    throw err;
  }

  const outputMeta = await sharp(optimizedBuffer).metadata().catch(() => ({}));
  const width = outputMeta.width || null;
  const height = outputMeta.height || null;
  const url = `/uploads/creator/${uniqueFilename}`;

  // CREATOR-16: record the upload so it can be ownership-validated (e.g. as
  // an "image" asset-library reference). A failed record must fail the
  // upload honestly — the catch above removes the orphaned file.
  const mediaId = crypto.randomUUID();
  execute(
    `INSERT INTO creator_media (id, creator_user_id, url, width, height, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [mediaId, userId, url, width, height, optimizedBuffer.length, new Date().toISOString()]
  );

  return {
    id: mediaId,
    url,
    width,
    height,
    bytes: optimizedBuffer.length,
  };
}
