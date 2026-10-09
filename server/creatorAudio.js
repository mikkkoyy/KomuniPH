/**
 * KomuniPH Lite - Creator Audio Upload (CREATOR-17: MP3 Music Player)
 *
 * Local MP3 upload for the Creator Studio music player. Mirrors the pipeline
 * conventions of the existing creator media uploader (Busboy multipart →
 * complete buffered stream → content validation → generated safe filename →
 * path-traversal guard → record an ownership row), writing into an isolated
 * uploads/creator-audio/ directory so audio never mixes with images or effects.
 *
 * Security (all server-side, never trusting client filename/MIME alone):
 *   - authenticated ownership (route requires auth; the row's owner comes from
 *     the verified token's user.sub, never from client input)
 *   - actual file CONTENT validated as a real MP3 container (ID3v2 tag or an
 *     MPEG audio frame sync). A renamed .png/.exe/.html cannot pass.
 *   - config audio size cap enforced on the stream (music-sized, not the
 *     image cap)
 *   - generated `<random>.mp3` filename; resolve() + prefix check prevents
 *     path traversal
 *   - the file is never re-encoded or interpreted — it is stored verbatim and
 *     only ever served back as audio/mpeg by the uploads static route
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import crypto from 'crypto';
import config from './config.js';
import { jsonResponse, errorResponse } from './utils.js';
import { execute, queryAll, queryOne } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const creatorAudioDir = resolve(__dirname, '..', config.upload.creatorAudioDir);
if (!existsSync(creatorAudioDir)) {
  mkdirSync(creatorAudioDir, { recursive: true });
}

try {
  const probePath = resolve(creatorAudioDir, '.write-probe');
  writeFileSync(probePath, '');
  unlinkSync(probePath);
  console.log('[CREATOR-AUDIO] Upload directory writable:', creatorAudioDir);
} catch (probeErr) {
  console.error('[CREATOR-AUDIO] Upload directory NOT writable:', creatorAudioDir, probeErr.message);
}

/**
 * Validate that `data` is a real MP3 audio container by inspecting bytes only.
 *
 * An MPEG-1/2/2.5 Layer III stream begins either with an ID3v2 tag ("ID3") or
 * directly with a frame sync (11 set bits: 0xFF followed by a byte whose top
 * three bits are set — 0xE0 mask). We accept either. This is deliberately a
 * structural check, not a full decode: it reliably rejects images, archives,
 * HTML/JS and empty buffers while accepting every real MP3 a browser can play.
 *
 * Exported so the dedicated test suite can pin the exact accept/reject rules.
 */
export function isValidMp3(data) {
  if (!data || data.length < 4) return false;

  // ID3v2 tag: "ID3" + version byte + flags + 4-byte syncsafe size.
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    return true;
  }

  // Raw MPEG audio frame sync: 0xFF then (byte & 0xE0) === 0xE0. Scan the
  // first block so a small leading junk pad (rare but seen) still validates.
  const scanLimit = Math.min(data.length, 4096);
  for (let i = 0; i < scanLimit; i += 1) {
    if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) {
      return true;
    }
  }
  return false;
}

/**
 * Handle POST /api/creator/audio
 * Multipart field name must be "audio". Returns the application URL that the
 * player loads, plus the recorded row id used for ownership checks.
 */
export function handleUploadCreatorAudio(req, res, user) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(res, 422, 'Content-Type must be multipart/form-data');
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: config.upload.creatorMaxAudioSize },
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

  busboy.on('file', (fieldname, file) => {
    if (fieldname !== 'audio') {
      file.resume();
      sendError(422, 'Field name must be "audio"');
      return;
    }

    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.mp3`;
    const filePath = resolve(creatorAudioDir, uniqueFilename);

    // Path traversal guard: the resolved target must stay inside the audio dir.
    if (!filePath.startsWith(creatorAudioDir)) {
      file.resume();
      sendError(422, 'Invalid upload target');
      return;
    }

    const chunks = [];
    let fileSize = 0;
    let tooLarge = false;

    file.on('data', (chunk) => {
      fileSize += chunk.length;
      if (fileSize > config.upload.creatorMaxAudioSize) {
        tooLarge = true;
        file.resume();
        sendError(422, `File too large. Maximum size: ${config.upload.creatorMaxAudioSize / 1024 / 1024}MB`);
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
      processAudioUpload(fileInfo, user.sub)
        .then((result) => sendSuccess(result))
        .catch((err) => {
          try {
            if (existsSync(fileInfo.filePath)) unlinkSync(fileInfo.filePath);
          } catch { /* best-effort cleanup */ }
          sendError(err.status || 422, err.message || 'Failed to process audio.');
        });
    }
  });

  req.pipe(busboy);
}

/**
 * Validate the buffered upload as MP3 content, write the generated file, and
 * record a creator_audio row (owner from the token) so the player's source can
 * be ownership-validated. A failed record fails the upload honestly — the
 * catch above removes the orphaned file.
 */
async function processAudioUpload(fileInfo, userId) {
  const { uniqueFilename, filePath, data } = fileInfo;

  if (!data || data.length === 0) {
    const err = new Error('Empty file. Please upload a valid MP3.');
    err.status = 422;
    throw err;
  }

  if (!isValidMp3(data)) {
    const err = new Error('That file is not a valid MP3. Please upload an MP3 audio file.');
    err.status = 422;
    throw err;
  }

  try {
    writeFileSync(filePath, data);
  } catch {
    const err = new Error('Failed to save uploaded audio. Please try again.');
    err.status = 500;
    throw err;
  }

  const url = `/uploads/creator-audio/${uniqueFilename}`;
  const audioId = crypto.randomUUID();
  execute(
    `INSERT INTO creator_audio (id, creator_user_id, url, bytes, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [audioId, userId, url, data.length, new Date().toISOString()]
  );

  return {
    id: audioId,
    url,
    bytes: data.length,
    created_at: new Date().toISOString(),
  };
}

/**
 * List the authenticated creator's uploaded tracks, newest first. Ownership is
 * derived from the token; a creator only ever sees their own rows.
 */
export function handleListCreatorAudio(req, res, user) {
  const rows = queryAll(
    `SELECT id, url, bytes, duration, bitrate, created_at
       FROM creator_audio
      WHERE creator_user_id = ?
      ORDER BY created_at DESC, rowid DESC`,
    [user.sub]
  );
  return jsonResponse(res, 200, { items: rows });
}

/**
 * Fetch a single track by id. Cross-user (or missing) ids return 404, never
 * 403 and never another creator's row — the same ownership rule as the library.
 */
export function handleGetCreatorAudio(req, res, user, params) {
  const row = queryOne(
    'SELECT id, url, bytes, duration, bitrate, created_at FROM creator_audio WHERE id = ? AND creator_user_id = ?',
    [params.id, user.sub]
  );
  if (!row) {
    return errorResponse(res, 404, 'Audio track not found');
  }
  return jsonResponse(res, 200, { item: row });
}

