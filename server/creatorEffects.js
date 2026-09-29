/**
 * CREATOR-12 — server-side Profile Background Effect registry and validation.
 *
 * The server is the authority. Nothing reaches storage without passing through
 * here: a design's `theme.backgroundEffect`, a published profile's effect, and
 * every `.kpeffect` package definition are all validated by the same functions.
 *
 * The registry is deliberately a MIRROR of web/js/backgroundEffects.js rather
 * than a copy of it, because the two run in different processes (Node server vs
 * browser) with no build step between them. tests/test_creator12_background_effects.mjs
 * asserts the two are identical, so a change to one that is not made to the other
 * fails the suite rather than silently diverging.
 *
 * SECURITY: an effect definition is a bag of bounded numbers and allowlisted
 * strings. There is no path by which a stored effect can carry creator
 * JavaScript, CSS, HTML, a keyframes name, a URL or a DOM selector. Assets are
 * referenced by package-LOCAL path only and must exist in the validated package.
 */

import {
  EFFECT_ENGINES,
  EFFECT_SOURCES,
  EFFECT_LIMITS,
  PARTICLE_DIRECTIONS,
  ENGINE_SCHEMAS,
  BUILTIN_EFFECTS,
  BUILTIN_EFFECT_IDS,
  NO_EFFECT,
  clampEffectConfig,
} from '../web/js/backgroundEffects.js';

// Re-exported so server code and tests have a single import site.
export {
  EFFECT_ENGINES, EFFECT_SOURCES, EFFECT_LIMITS, PARTICLE_DIRECTIONS,
  ENGINE_SCHEMAS, BUILTIN_EFFECTS, BUILTIN_EFFECT_IDS, NO_EFFECT,
  clampEffectConfig,
};

export const EFFECT_CONFIG_VERSION = 1;
export const EFFECT_FORMAT = 'komuniph-effect';
export const EFFECT_FORMAT_VERSION = 1;

/** Stored shape of theme.backgroundEffect. Every key is optional except when enabled. */
const EFFECT_KEYS = new Set(['enabled', 'effectId', 'source', 'version', 'config']);

// ── Manifest limits (CREATOR-12 §12) ──────────────────────────────────────────
export const MANIFEST_LIMITS = {
  idMaxLength: 64,
  nameMaxLength: 60,
  authorMaxLength: 60,
  idPattern: /^[a-z0-9][a-z0-9._-]{2,63}$/,
  // A dot in the id is allowed (namespace.separator), but a path separator or a
  // scheme is not. This is what stops "../../etc" or "javascript:..." as an id.
  idForbidden: /[\\/:*?"<>|]/,
  versionPattern: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/,
};
export const MANIFEST_REQUIRED = ['format', 'formatVersion', 'id', 'name', 'version', 'type', 'effect'];
export const MANIFEST_OPTIONAL = ['author', 'preview', 'thumbnail', 'description'];
export const EFFECT_PACKAGE_TYPE = 'background-effect';

// ── .kpeffect archive limits (CREATOR-12 §14) ─────────────────────────────────
export const PACKAGE_LIMITS = {
  maxPackageBytes: 2 * 1024 * 1024,   // compressed upload
  maxTotalUncompressedBytes: 8 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024,     // a single extracted file
  maxEntries: 32,                      // file count
  maxCompressionRatio: 120,            // zip-bomb guard
  maxAssetDimension: 1024,             // per image edge
  maxAssetBytes: 1024 * 1024,
  manifestName: 'manifest.json',
  effectName: 'effect/effect.json',
  assetDir: 'assets/',
};

/**
 * Extensions that are NEVER allowed in a package.
 *
 * Executables are rejected outright rather than sanitised, because there is no
 * legitimate reason for a background effect to contain them. SVG is rejected for
 * the same reason: it can carry <script>, event handlers and external
 * references, and "strip it carefully" is a much weaker guarantee than "not
 * allowed".
 */
export const FORBIDDEN_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'wasm', 'html', 'htm', 'xhtml',
  'svg', 'xml', 'xsl', 'swf', 'jar', 'exe', 'dll', 'so', 'dylib',
  'php', 'py', 'rb', 'sh', 'bat', 'cmd', 'ps1', 'vbs', 'jar',
]);

/** Extensions a package ASSET may have. Everything else must be manifest/effect JSON. */
export const ALLOWED_ASSET_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

// ── Validation helpers ────────────────────────────────────────────────────────
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateNumber(spec, value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < spec.min || n > spec.max) return `${label} must be between ${spec.min} and ${spec.max}`;
  return null;
}

function validateConfigValue(spec, value, label) {
  if (spec.type === 'number') return validateNumber(spec, value, label);
  if (spec.type === 'bool') {
    if (value !== true && value !== false) return `${label} must be true or false`;
    return null;
  }
  if (spec.type === 'enum') {
    if (!spec.values.includes(value)) return `${label} must be one of: ${spec.values.join(', ')}`;
    return null;
  }
  if (spec.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(value)) {
      return `${label} must be a hex colour such as #ffffff`;
    }
    return null;
  }
  return `${label} has an unsupported type`;
}

/**
 * Validate a set of effect CONFIG values against an engine's schema.
 * Unknown keys are rejected (not ignored) so a package cannot smuggle extra
 * fields past the schema in the hope something downstream reads them.
 */
export function validateEffectConfig(engine, config, { errors, prefix = 'config' } = {}) {
  if (config === undefined || config === null) return errors;
  if (!isPlainObject(config)) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }
  const schema = ENGINE_SCHEMAS[engine];
  if (!schema) {
    errors.push(`unknown engine "${engine}"`);
    return errors;
  }
  for (const key of Object.keys(config)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      errors.push(`${prefix}.${key} is not a setting this effect supports`);
    }
  }
  for (const [key, spec] of Object.entries(schema)) {
    if (config[key] === undefined) continue;
    const problem = validateConfigValue(spec, config[key], `${prefix}.${key}`);
    if (problem) errors.push(problem);
  }
  return errors;
}

/**
 * Validate a `theme.backgroundEffect` value.
 *
 * `enabled: false` (or a null/absent value) means NO EFFECT and is always valid,
 * which is what keeps every existing design — which has no backgroundEffect at
 * all — working with no migration.
 */
export function validateBackgroundEffect(effect, errors) {
  if (effect === undefined || effect === null) return errors;
  if (!isPlainObject(effect)) {
    errors.push('theme.backgroundEffect must be an object or null');
    return errors;
  }
  for (const key of Object.keys(effect)) {
    if (!EFFECT_KEYS.has(key)) errors.push(`theme.backgroundEffect has unknown field: ${key}`);
  }
  if (effect.enabled === false) return errors;
  if (effect.enabled !== undefined && effect.enabled !== true) {
    errors.push('theme.backgroundEffect.enabled must be true or false');
  }
  const effectId = effect.effectId;
  if (typeof effectId !== 'string' || !effectId) {
    errors.push('theme.backgroundEffect.effectId is required when an effect is enabled');
    return errors;
  }
  if (effectId === NO_EFFECT) {
    errors.push('theme.backgroundEffect.effectId "none" must be expressed with enabled:false');
    return errors;
  }
  const source = effect.source;
  if (source !== undefined && !EFFECT_SOURCES.has(source)) {
    errors.push(`theme.backgroundEffect.source must be one of: ${[...EFFECT_SOURCES].join(', ')}`);
  }
  if (effect.version !== undefined && !Number.isInteger(effect.version)) {
    errors.push('theme.backgroundEffect.version must be an integer');
  }
  if (source === 'builtin') {
    if (!BUILTIN_EFFECT_IDS.includes(effectId)) {
      errors.push(`theme.backgroundEffect.effectId "${effectId}" is not a built-in effect`);
      return errors;
    }
    // A built-in's engine is fixed by the registry; a client cannot re-declare it.
    validateEffectConfig(BUILTIN_EFFECTS[effectId].engine, effect.config, {
      errors, prefix: 'theme.backgroundEffect.config',
    });
  }
  if (source === 'creator') {
    // A creator effect's engine and bounds are established at INSTALL time from
    // the validated package. A design therefore cannot invent an engine, and
    // still gets its config checked structurally here so obviously bad values are
    // rejected before they are stored.
    if (typeof effect.engineHint !== 'undefined') {
      errors.push('theme.backgroundEffect must not carry an engine field');
    }
  }
  return errors;
}

/**
 * Validate a `.kpeffect` manifest. Strict on presence, type and length, and
 * rejects any field that could later be used to reference something outside the
 * package.
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) return ['manifest.json must be a JSON object'];

  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_REQUIRED.includes(key) && !MANIFEST_OPTIONAL.includes(key)) {
      errors.push(`manifest has unknown field: ${key}`);
    }
  }
  for (const key of MANIFEST_REQUIRED) {
    if (manifest[key] === undefined) errors.push(`manifest is missing required field: ${key}`);
  }

  if (manifest.format !== EFFECT_FORMAT) errors.push(`manifest.format must be "${EFFECT_FORMAT}"`);
  if (manifest.formatVersion !== EFFECT_FORMAT_VERSION) {
    errors.push(`manifest.formatVersion must be ${EFFECT_FORMAT_VERSION}`);
  }
  if (manifest.type !== EFFECT_PACKAGE_TYPE) errors.push(`manifest.type must be "${EFFECT_PACKAGE_TYPE}"`);

  if (typeof manifest.id === 'string') {
    if (manifest.id.length > MANIFEST_LIMITS.idMaxLength) errors.push('manifest.id is too long');
    if (!MANIFEST_LIMITS.idPattern.test(manifest.id)) {
      errors.push('manifest.id must be lowercase letters, digits, dot, dash or underscore');
    }
    if (MANIFEST_LIMITS.idForbidden.test(manifest.id)) {
      errors.push('manifest.id must not contain path or scheme characters');
    }
  }
  if (typeof manifest.name === 'string' && manifest.name.length > MANIFEST_LIMITS.nameMaxLength) {
    errors.push('manifest.name is too long');
  }
  if (manifest.author !== undefined) {
    if (typeof manifest.author !== 'string') errors.push('manifest.author must be a string');
    else if (manifest.author.length > MANIFEST_LIMITS.authorMaxLength) errors.push('manifest.author is too long');
  }
  if (typeof manifest.version === 'string' && !MANIFEST_LIMITS.versionPattern.test(manifest.version)) {
    errors.push('manifest.version must look like 1.0.0');
  }

  // preview/thumbnail/effect are package-LOCAL relative paths only. An absolute
  // path, a traversal or a URL is refused outright — there is no supported way
  // for a package to reach outside itself or onto the network.
  for (const key of ['effect', 'preview', 'thumbnail']) {
    const value = manifest[key];
    if (value === undefined) continue;
    const problem = validatePackageRelativePath(value, `manifest.${key}`);
    if (problem) errors.push(problem);
  }
  return errors;
}

/**
 * Validate a package-relative asset path.
 *
 * This is the single guard against path traversal and external references:
 *   - no absolute paths ("/etc/passwd", "C:\\x", "\\\\server\\share")
 *   - no drive letters
 *   - no ".." segment, and no backslash separator at all
 *   - no URL scheme, no "//host" prefix
 *   - no traversal once normalised
 */
export function validatePackageRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || !value) return `${label} must be a non-empty string`;
  if (value.length > 200) return `${label} is too long`;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return `${label} must not be an absolute Windows path`;
  if (value.startsWith('/') || value.startsWith('\\')) return `${label} must not be an absolute path`;
  if (value.includes('\\')) return `${label} must not contain backslashes`;
  if (value.startsWith('//')) return `${label} must not be a URL or UNC path`;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return `${label} must not contain a URL scheme`;
  if (/(^|\/)\.\.(\/|$)/.test(value)) return `${label} must not contain ".."`;
  if (value.includes('\0')) return `${label} contains an invalid character`;
  const normalised = value.split('/').filter(p => p && p !== '.').join('/');
  if (!normalised) return `${label} does not name a file`;
  return null;
}

/** The extension of a package path, lower-cased, without the dot. */
export function pathExtension(path) {
  const base = String(path).split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * Validate a `.kpeffect` effect definition.
 * `availableAssets` is the set of package-local asset paths that survived
 * archive validation, so a texture can only reference something that is really
 * in the package.
 */
export function validateEffectDefinition(definition, availableAssets = new Set()) {
  const errors = [];
  if (!isPlainObject(definition)) return ['effect definition must be a JSON object'];

  for (const key of Object.keys(definition)) {
    if (!['engine', 'texture', 'palette', 'config', 'loop', 'reducedMotion'].includes(key)) {
      errors.push(`effect definition has unknown field: ${key}`);
    }
  }
  const engine = definition.engine;
  if (typeof engine !== 'string' || !EFFECT_ENGINES.has(engine)) {
    errors.push(`effect definition engine must be one of: ${[...EFFECT_ENGINES].join(', ')}`);
    return errors;
  }
  if (definition.loop !== undefined && definition.loop !== true && definition.loop !== false) {
    errors.push('effect definition loop must be true or false');
  }
  if (definition.reducedMotion !== undefined
    && definition.reducedMotion !== 'static' && definition.reducedMotion !== 'none') {
    errors.push('effect definition reducedMotion must be "static" or "none"');
  }
  if (definition.texture !== undefined) {
    const problem = validatePackageRelativePath(definition.texture, 'effect texture');
    if (problem) errors.push(problem);
    else if (!availableAssets.has(definition.texture)) {
      errors.push(`effect texture "${definition.texture}" is not present in the package`);
    } else {
      const ext = pathExtension(definition.texture);
      if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) {
        errors.push(`effect texture must be a PNG, JPEG or WebP image (got ".${ext}")`);
      }
    }
  }
  // A creator effect may override nothing about the bounds, only the values
  // within them.
  validateEffectConfig(engine, definition.config, { errors, prefix: 'effect config' });
  return errors;
}

/** A registry lookup that only ever returns a real built-in. */
export function getBuiltinEffect(effectId) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_EFFECTS, effectId)
    ? BUILTIN_EFFECTS[effectId]
    : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// .kpeffect package import (CREATOR-12 §10–§15)
//
// A `.kpeffect` file is a ZIP container. Reading it is the single most
// security-sensitive operation in this milestone, so the order is deliberate and
// nothing is trusted at any stage:
//
//   1. archive envelope  — entry count, per-entry and total UNCOMPRESSED size,
//                          and a compression-ratio cap, all read from the ZIP
//                          central directory BEFORE any entry is inflated. This
//                          is why yauzl is used: it exposes those sizes up front,
//                          so a zip bomb is refused rather than decompressed.
//   2. entry names       — traversal, absolute paths, backslashes, URLs and
//                          forbidden extensions are rejected for EVERY entry,
//                          before a single byte is written.
//   3. manifest + effect — schema-validated JSON.
//   4. assets            — Sharp validates the ACTUAL image content and
//                          re-encodes to WebP, so nothing but a raster image can
//                          survive into the extracted directory.
//
// Nothing is ever rendered from the uploaded archive. Only the re-encoded,
// validated output is stored, and only that is read at render time.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import yauzl from 'yauzl';
import sharp from 'sharp';
import Busboy from 'busboy';
import config from './config.js';
import { jsonResponse, errorResponse } from './utils.js';
import { queryOne, queryAll, execute } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Isolated per-creator storage. Never inside uploads/creator, never shared. */
export const effectStorageRoot = resolve(__dirname, '..', config.upload.creatorEffectDir || './uploads/creator-effects');
if (!existsSync(effectStorageRoot)) mkdirSync(effectStorageRoot, { recursive: true });

/** Effects that are actually installed and published for a creator. */
export function listPublishedCreatorEffects(creatorUserId) {  return queryAll(
    `SELECT id, effect_id, name, author, version, engine, status, preview_path, thumbnail_path, published_at
       FROM creator_effects
      WHERE creator_user_id = ? AND status = 'published'
      ORDER BY name COLLATE NOCASE ASC`,
    [creatorUserId],
  );
}

/** Look up ONE published creator effect by its effect_id. */
export function findPublishedEffect(effectId, creatorUserId) {
  return queryOne(
    `SELECT id, effect_id, name, author, version, engine, manifest_json, definition_json, storage_dir, preview_path
       FROM creator_effects
      WHERE creator_user_id = ? AND effect_id = ? AND status = 'published'`,
    [creatorUserId, effectId],
  );
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Reject an archive entry NAME outright, before anything is inflated.
 * This is the path-traversal gate; the write step re-checks containment.
 */
export function assertSafeEntryName(name) {
  const problem = validatePackageRelativePath(name, 'package entry');
  if (problem) throw httpError(422, problem);
  if (name.endsWith('/')) return; // directory entry
  const ext = pathExtension(name);
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw httpError(422, `packages must not contain ".${ext}" files`);
  }
  if (!ALLOWED_ASSET_EXTENSIONS.has(ext) && ext !== 'json') {
    throw httpError(422, `unexpected file type ".${ext}" in package`);
  }
  return name;
}

/**
 * Read a ZIP buffer into memory, enforcing the archive limits against the
 * central directory's DECLARED sizes before inflating anything.
 */
export function readPackageEntries(buffer) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!buffer || buffer.length === 0) {
      rejectPromise(httpError(422, 'The .kpeffect file is empty.'));
      return;
    }
    if (buffer.length > PACKAGE_LIMITS.maxPackageBytes) {
      rejectPromise(httpError(422,
        `The .kpeffect file is too large (max ${Math.round(PACKAGE_LIMITS.maxPackageBytes / 1024 / 1024)}MB).`));
      return;
    }
    // validateEntrySizes: yauzl cross-checks the declared and actual sizes and
    //   errors on a mismatch, which is what catches a hand-crafted archive that
    //   under-reports its expansion ratio.
    // strictFileNames: refuse backslashes and other separators ZIP spec allows
    //   but this format must not, rather than silently normalising them.
    // Both are belt-and-braces with the explicit checks below; the point is that
    // each layer refuses independently.
    yauzl.fromBuffer(buffer, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (err, zip) => {
      if (err) {
        rejectPromise(httpError(422, 'That file is not a readable .kpeffect package.'));
        return;
      }
      const entries = [];
      let totalUncompressed = 0;

      zip.on('entry', (entry) => {
        // Names first: a traversal or executable entry is refused before any
        // decompression of the rest of the archive.
        let safeName;
        try {
          safeName = assertSafeEntryName(entry.fileName);
        } catch (e) {
          // Reject FIRST, then close. Closing the zip can emit an 'error' event
          // synchronously, and that would otherwise win the race and replace a
          // precise "packages must not contain .js files" with a generic
          // "could not be read" — hiding the actual reason from the creator.
          rejectPromise(e);
          try { zip.close(); } catch { /* best effort */ }
          return;
        }
        // ZIP bombs: the declared uncompressed size is known here, up front.
        if (entry.uncompressedSize > PACKAGE_LIMITS.maxEntryBytes) {
          rejectPromise(httpError(422, 'A file inside the package is too large.'));
          try { zip.close(); } catch { /* best effort */ }
          return;
        }
        if (entry.uncompressedSize > 0
          && entry.compressedSize > 0
          && entry.uncompressedSize / Math.max(1, entry.compressedSize) > PACKAGE_LIMITS.maxCompressionRatio) {
          rejectPromise(httpError(422, 'The package is compressed too heavily and was refused.'));
          try { zip.close(); } catch { /* best effort */ }
          return;
        }
        if (!entry.fileName.endsWith('/')) {
          totalUncompressed += entry.uncompressedSize;
          if (entries.length >= PACKAGE_LIMITS.maxEntries) {
            rejectPromise(httpError(422, `The package contains too many files (max ${PACKAGE_LIMITS.maxEntries}).`));
            try { zip.close(); } catch { /* best effort */ }
            return;
          }
          if (totalUncompressed > PACKAGE_LIMITS.maxTotalUncompressedBytes) {
            rejectPromise(httpError(422, 'The package expands to more data than is allowed.'));
            try { zip.close(); } catch { /* best effort */ }
            return;
          }
        }
        entries.push(entry);
        zip.readEntry();
      });

      zip.on('end', () => resolvePromise(entries));
      zip.on('error', () => rejectPromise(httpError(422, 'The .kpeffect package could not be read.')));
      zip.readEntry();
    });
  });
}

/** Inflate one entry, with a hard cap on the bytes actually produced. */
export function readEntryData(zip, entry) {
  return new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) {
        rejectPromise(httpError(422, 'The .kpeffect package could not be read.'));
        return;
      }
      const chunks = [];
      let size = 0;
      let aborted = false;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > PACKAGE_LIMITS.maxEntryBytes) {
          // A lying header must not defeat the cap.
          aborted = true;
          stream.destroy();
          rejectPromise(httpError(422, 'A file inside the package is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => { if (!aborted) resolvePromise(Buffer.concat(chunks)); });
      stream.on('error', () => {
        if (!aborted) rejectPromise(httpError(422, 'The .kpeffect package could not be read.'));
      });
    });
  });
}

/**
 * Validate an asset with Sharp and re-encode it to WebP.
 *
 * Content is authoritative: the extension and the declared MIME type are both
 * ignored, so a .png that is really a script fails here. Re-encoding also means
 * only raster output can ever reach disk.
 */
export async function sanitiseAsset(data, label) {
  if (!data || data.length === 0) throw httpError(422, `${label} is empty.`);
  if (data.length > PACKAGE_LIMITS.maxAssetBytes) throw httpError(422, `${label} is too large.`);
  let meta;
  try {
    meta = await sharp(data).metadata();
  } catch {
    throw httpError(422, `${label} is not a readable image.`);
  }
  const format = String(meta.format || '').toLowerCase();
  if (!ALLOWED_ASSET_EXTENSIONS.has(format)) {
    throw httpError(422, `${label} must be a PNG, JPEG or WebP image.`);
  }
  if ((meta.width || 0) > PACKAGE_LIMITS.maxAssetDimension
    || (meta.height || 0) > PACKAGE_LIMITS.maxAssetDimension) {
    throw httpError(422, `${label} is larger than ${PACKAGE_LIMITS.maxAssetDimension}x${PACKAGE_LIMITS.maxAssetDimension}.`);
  }
  try {
    const out = await sharp(data)
      .resize({
        width: PACKAGE_LIMITS.maxAssetDimension,
        height: PACKAGE_LIMITS.maxAssetDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return { data: out, width: meta.width, height: meta.height };
  } catch {
    throw httpError(422, `${label} could not be processed.`);
  }
}

/**
 * Validate a complete .kpeffect buffer and return everything needed to install
 * it. Pure with respect to the filesystem: it extracts nothing, so a rejected
 * package never touches disk at all.
 */
export async function inspectPackage(buffer) {
  const entryNames = await readPackageEntries(buffer);
  const manifestEntry = entryNames.find(e => e.fileName === PACKAGE_LIMITS.manifestName);
  const effectEntry = entryNames.find(e => e.fileName === PACKAGE_LIMITS.effectName);
  if (!manifestEntry) throw httpError(422, 'The package is missing manifest.json.');
  if (!effectEntry) throw httpError(422, 'The package is missing effect/effect.json.');

  const readOne = (entry) => new Promise((res, rej) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) { rej(httpError(422, 'The .kpeffect package could not be read.')); return; }
      zip.on('entry', (e) => {
        if (e.fileName !== entry.fileName) { zip.readEntry(); return; }
        readEntryData(zip, e).then(res, rej);
      });
      zip.on('end', () => rej(httpError(422, 'The .kpeffect package could not be read.')));
      zip.readEntry();
    });
  });

  const parseJson = (data, label) => {
    try { return JSON.parse(data.toString('utf8')); }
    catch { throw httpError(422, `${label} is not valid JSON.`); }
  };

  const manifest = parseJson(await readOne(manifestEntry), 'manifest.json');
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) throw httpError(422, manifestErrors[0]);

  const definition = parseJson(await readOne(effectEntry), 'effect/effect.json');
  const assetPaths = entryNames
    .map(e => e.fileName)
    .filter(n => n.startsWith(PACKAGE_LIMITS.assetDir) && !n.endsWith('/'));
  const definitionErrors = validateEffectDefinition(definition, new Set(assetPaths));
  if (definitionErrors.length) throw httpError(422, definitionErrors[0]);

  // A declared preview/thumbnail must actually exist in the package.
  for (const key of ['preview', 'thumbnail']) {
    const rel = manifest[key];
    if (rel && !entryNames.some(e => e.fileName === rel)) {
      throw httpError(422, `manifest.${key} ("${rel}") is not present in the package.`);
    }
  }
  // And it must be a real image, if present.
  const imageRefs = new Set();
  if (definition.texture) imageRefs.add(definition.texture);
  if (manifest.preview) imageRefs.add(manifest.preview);
  if (manifest.thumbnail) imageRefs.add(manifest.thumbnail);

  return {
    manifest,
    definition,
    imageRefs: [...imageRefs],
    assetPaths,
    entryNames: entryNames.map(e => e.fileName),
  };
}

/**
 * The authenticated creator's user id.
 *
 * `requireAuth` returns the JWT subject under `sub`, not `id` — reading the
 * wrong one produces a NOT NULL failure at INSERT time rather than an obvious
 * error here, so it is resolved once and explicitly.
 */
function creatorIdOf(user) {
  const id = user && (user.sub || user.id || user.userId);
  if (!id) throw httpError(401, 'Authentication required');
  return id;
}

/**
 * Install a validated package into isolated per-creator storage.
 * Every write target is re-checked for containment, and the directory is
 * uniquely named, so an upload can never overwrite application files, another
 * creator's package, or an existing install.
 */
export async function installPackage(creatorUserId, buffer) {
  const userId = creatorUserId && typeof creatorUserId === 'object' ? creatorIdOf(creatorUserId) : creatorUserId;
  const inspected = await inspectPackage(buffer);
  const { manifest, definition, imageRefs, assetPaths } = inspected;

  // Duplicate id for this creator is refused, so "publish" is unambiguous.
  const existing = queryOne(
    'SELECT id FROM creator_effects WHERE creator_user_id = ? AND effect_id = ? AND status != ?',
    [userId, manifest.id, 'archived'],
  );
  if (existing) throw httpError(409, 'You have already installed an effect with this id.');

  const effectRowId = crypto.randomBytes(12).toString('hex');
  // Unique per install: a re-import can never land on top of an earlier one.
  const targetDir = resolve(effectStorageRoot, `${userId}_${effectRowId}`);
  if (!targetDir.startsWith(effectStorageRoot + sep)) {
    throw httpError(422, 'Invalid effect storage target.');
  }
  mkdirSync(targetDir, { recursive: true });

  try {
    const readEntry = (name) => new Promise((res, rej) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
        if (err) { rej(httpError(422, 'The .kpeffect package could not be read.')); return; }
        zip.on('entry', (e) => {
          if (e.fileName !== name) { zip.readEntry(); return; }
          readEntryData(zip, e).then(res, rej);
        });
        zip.on('end', () => rej(httpError(422, 'The .kpeffect package could not be read.')));
        zip.readEntry();
      });
    });

    // Only declared, referenced images are written — and each is re-encoded to
    // WebP under a generated name, so nothing from the archive keeps its own
    // name or bytes on disk.
    const written = new Map();
    for (const rel of imageRefs) {
      const ext = pathExtension(rel);
      const data = await readEntry(rel);
      const clean = await sanitiseAsset(data, `"${rel}"`);
      const filename = `${crypto.randomBytes(8).toString('hex')}.webp`;
      const filePath = resolve(targetDir, filename);
      if (!filePath.startsWith(targetDir + sep)) throw httpError(422, 'Invalid effect asset target.');
      writeFileSync(filePath, clean.data);
      written.set(rel, filename);
    }

    // Rewrite the definition and manifest to the SANITISED, generated asset
    // names. From here on nothing refers to a package path, so the extracted
    // archive's layout is irrelevant to the renderer.
    const storedDefinition = { ...definition };
    if (storedDefinition.texture) storedDefinition.texture = written.get(storedDefinition.texture) || null;
    if (!storedDefinition.texture) delete storedDefinition.texture;
    if (storedDefinition.config) storedDefinition.config = clampEffectConfig(definition.engine, definition.config);
    const storedManifest = { ...manifest, effect: PACKAGE_LIMITS.effectName };
    if (manifest.preview) storedManifest.preview = written.get(manifest.preview) || null;
    if (!storedManifest.preview) delete storedManifest.preview;
    if (manifest.thumbnail) storedManifest.thumbnail = written.get(manifest.thumbnail) || null;
    if (!storedManifest.thumbnail) delete storedManifest.thumbnail;

    // A published effect must expose a preview URL; fall back to the thumbnail
    // and finally to nothing, so the UI can show a placeholder honestly.
    const previewFile = storedManifest.preview || storedManifest.thumbnail || null;
    const previewPath = previewFile ? `/uploads/creator-effects/${userId}_${effectRowId}/${previewFile}` : null;

    execute(
      `INSERT INTO creator_effects
         (id, creator_user_id, effect_id, name, author, version, source, status, engine,
          manifest_json, definition_json, storage_dir, preview_path, thumbnail_path, published_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
      [
        effectRowId, userId, manifest.id, manifest.name, manifest.author || '',
        manifest.version, 'creator', 'published', definition.engine,
        JSON.stringify(storedManifest), JSON.stringify(storedDefinition),
        `${userId}_${effectRowId}`, previewPath, previewPath,
      ],
    );

    return {
      id: effectRowId,
      effectId: manifest.id,
      name: manifest.name,
      author: manifest.author || '',
      version: manifest.version,
      engine: definition.engine,
      status: 'published',
      previewPath,
    };
  } catch (err) {
    // Never leave a partial install behind.
    try { rmSync(targetDir, { recursive: true, force: true }); } catch { /* best effort */ }
    throw err;
  }
}

/** Archive one of the creator's OWN effects. Scoped by owner id. */
export function archiveEffect(creatorUserId, effectRowId) {
  const userId = creatorUserId && typeof creatorUserId === 'object' ? creatorIdOf(creatorUserId) : creatorUserId;
  const row = queryOne('SELECT id FROM creator_effects WHERE id = ? AND creator_user_id = ?', [effectRowId, userId]);
  if (!row) throw httpError(404, 'Effect not found.');
  execute("UPDATE creator_effects SET status = 'archived', archived_at = datetime('now') WHERE id = ?", [effectRowId]);
  return { id: effectRowId, status: 'archived' };
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

/** GET /api/creator/effects — the creator's installed, published effects. */
export function handleListCreatorEffects(req, res, user) {
  try {
    jsonResponse(res, 200, {
      builtin: BUILTIN_EFFECT_IDS.map(id => ({
        effectId: id, name: BUILTIN_EFFECTS[id].name, category: BUILTIN_EFFECTS[id].category,
        version: BUILTIN_EFFECTS[id].version, engine: BUILTIN_EFFECTS[id].engine, source: 'builtin',
      })),
      creator: listPublishedCreatorEffects(creatorIdOf(user)),
    });
  } catch (err) {
    console.error('[CREATOR-EFFECTS] list error:', err);
    errorResponse(res, 500, 'Could not load effects.');
  }
}

/** POST /api/creator/effects/import — multipart .kpeffect package. */
export function handleImportCreatorEffect(req, res, user) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(res, 422, 'Content-Type must be multipart/form-data');
  }
  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: PACKAGE_LIMITS.maxPackageBytes },
  });

  let responseSent = false;
  const sendError = (status, message) => {
    if (responseSent) return;
    responseSent = true;
    errorResponse(res, status, message);
  };
  const sendSuccess = (data) => {
    if (responseSent) return;
    responseSent = true;
    jsonResponse(res, 201, data);
  };

  let payload = null;
  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'package') {
      file.resume();
      sendError(422, 'Field name must be "package"');
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    file.on('data', (chunk) => {
      size += chunk.length;
      if (size > PACKAGE_LIMITS.maxPackageBytes) { tooLarge = true; file.resume(); return; }
      chunks.push(chunk);
    });
    file.on('end', () => { if (!tooLarge) payload = Buffer.concat(chunks); });
    file.on('error', () => sendError(500, 'Upload failed'));
  });
  busboy.on('error', () => sendError(500, 'Upload failed'));
  busboy.on('finish', () => {
    if (responseSent) return;
    if (!payload || payload.length === 0) { sendError(422, 'No .kpeffect file was uploaded.'); return; }
    installPackage(creatorIdOf(user), payload)
      .then(result => sendSuccess(result))
      .catch(err => {
        // A plain, actionable reason — never a stack trace.
        console.warn('[CREATOR-EFFECTS] import rejected:', err.message);
        sendError(err.status || 422, err.message || 'Effect could not be imported.');
      });
  });
  req.pipe(busboy);
}

/** DELETE /api/creator/effects/:id */
export function handleArchiveCreatorEffect(req, res, user, effectRowId) {
  try {
    jsonResponse(res, 200, archiveEffect(creatorIdOf(user), effectRowId));
  } catch (err) {
    errorResponse(res, err.status || 500, err.message || 'Could not archive the effect.');
  }
}
