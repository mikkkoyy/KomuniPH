/**
 * KomuniPH Lite - Creator Asset Publishing Foundation (CREATOR-02)
 *
 * Server-side validation + API for creator-owned, reusable products. An asset
 * is a controlled snapshot that will later feed the Marketplace catalog; this
 * milestone deliberately implements NO purchases, checkouts, payments, coin
 * movements, inventory or payouts — price_coins is stored, validated and
 * documented, and nothing ever debits user_wallets or writes coin_transactions.
 *
 * Security posture mirrors profileDesign.js:
 *   - ownership is always derived from the authenticated user (user.sub),
 *     never from a client-supplied creator id
 *   - asset_data is a strict per-type JSON contract reusing the existing
 *     design/theme validators; no raw HTML, JS, executable CSS, hidden
 *     iframe/object/embed payloads, or non-http(s) image URLs are accepted
 *   - version, status, creator_user_id and preview_data are server-derived;
 *     a client can never set them
 */

import { queryOne, queryAll, execute } from './database.js';
import { jsonResponse, errorResponse, parseBody, generateId, now } from './utils.js';
import { requireAdmin } from './auth.js';
import { validateDesignPayload } from './profileDesign.js';
import { validateThemeConfig } from './profile.js';
import {
  isPlainObject,
  isFiniteNumber,
  jsonSafeValue,
  DANGEROUS_CONFIG_RE,
  HTTP_URL_RE,
  IMAGE_FITS,
} from './profileDesign.js';

/**
 * The creator products the current system can safely represent. Only these are
 * accepted; everything else (music, reaction, widget, video, ...) stays out of
 * the registry until a real, validated representation exists.
 */
export const CREATOR_ASSET_TYPES = new Set([
  'theme',
  'background',
  'profile_design',
  'sticker',
  'decoration',
]);

/**
 * './rejected'/'submitted' are reserved model states. No moderation workflow
 * exists yet, so nothing ever transitions an asset to 'rejected'; 'submitted'
 * is the validation checkpoint a creator passes before publishing.
 */
export const CREATOR_ASSET_STATUSES = new Set([
  'draft', 'submitted', 'published', 'archived', 'rejected',
]);

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_ASSET_BYTES = 512 * 1024; // same ceiling as a profile design layout
const PRICE_COINS_MAX = 1000000000;

async function readJsonBody(req, res) {
  try {
    return await parseBody(req);
  } catch (err) {
    errorResponse(res, 400, 'Invalid JSON request body');
    return null;
  }
}

// ── Per-type asset_data contracts ─────────────────────────────────────────────
// Each validator reports errors and, when clean, may normalize field shape.

function validateThemeAssetData(body, errors) {
  const data = {};
  if (!isPlainObject(body)) {
    errors.push('theme asset_data must be an object containing a theme config');
    return data;
  }
  const allowed = new Set(['theme']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unknown theme asset_data field: ${key}`);
  }
  if (body.theme === null || body.theme === undefined) {
    data.theme = null;
  } else if (!isPlainObject(body.theme)) {
    errors.push('asset_data.theme must be an object or null');
  } else {
    const themeErrors = validateThemeConfig(body.theme);
    errors.push(...themeErrors.map(e => `asset_data.theme: ${e}`));
    if (themeErrors.length === 0) data.theme = body.theme;
  }
  return data;
}

function validateProfileDesignAssetData(body, errors) {
  const data = {};
  if (!isPlainObject(body)) {
    errors.push('profile_design asset_data must be an object containing a design snapshot');
    return data;
  }
  const allowed = new Set(['layout', 'theme']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unknown profile_design asset_data field: ${key}`);
  }
  // Reuse the exact CREATOR-01A/01B design validator; content components,
  // geometry, z-index, rotation and style are all re-checked here.
  const { errors: designErrors, data: designData } = validateDesignPayload(
    { layout: body.layout, theme: body.theme },
    { partial: true }
  );
  errors.push(...designErrors.map(e => `asset_data: ${e}`));
  if (designErrors.length === 0) {
    data.layout = designData.layout;
    data.theme = designData.theme;
  }
  return data;
}

function validateImageAssetData(body, errors, type) {
  const data = {};
  if (!isPlainObject(body)) {
    errors.push(`${type} asset_data must be an object containing an image URL`);
    return data;
  }
  const allowed = new Set(['imageUrl', 'fit']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) errors.push(`Unknown ${type} asset_data field: ${key}`);
  }
  if (typeof body.imageUrl !== 'string' || !HTTP_URL_RE.test(body.imageUrl)) {
    errors.push(`${type} asset_data.imageUrl must be a valid http(s) image URL`);
  } else {
    data.imageUrl = body.imageUrl;
  }
  if (body.fit !== undefined && body.fit !== null) {
    if (!IMAGE_FITS.has(body.fit)) {
      errors.push(`${type} asset_data.fit must be one of: ${[...IMAGE_FITS].join(', ')}`);
    } else {
      data.fit = body.fit;
    }
  }
  return data;
}

function validateAssetData(type, body, errors) {
  switch (type) {
    case 'theme':
      return validateThemeAssetData(body, errors);
    case 'profile_design':
      return validateProfileDesignAssetData(body, errors);
    case 'background':
    case 'sticker':
    case 'decoration':
      return validateImageAssetData(body, errors, type);
    default:
      errors.push(`Unknown asset type: ${String(type)}`);
      return {};
  }
}

/**
 * Per-type, render-safe preview derived from the VALIDATED model only. The
 * preview is never user-authored markup — it is the canonical safe projection
 * a future Marketplace catalog may serve to non-creators.
 */
function derivePreviewData(type, data) {
  if (type === 'theme') {
    return { theme: data.theme };
  }
  if (type === 'profile_design') {
    return { layout: data.layout, theme: data.theme };
  }
  return { imageUrl: data.imageUrl, fit: data.fit };
}

/**
 * Validate + normalize a creator-asset payload. Accepts a full create body
 * ({ name, description?, asset_type, asset_data, price_coins?, source_design_id? })
 * or a partial PATCH. Returns { errors, data } where data (when errors is
 * empty) holds canonical values to persist. version/status/preview_data and
 * creator identity are intentionally NOT readable from the client.
 */
export function validateAssetPayload(body, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object'], data: null };
  }

  const data = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > MAX_NAME_LENGTH) {
      errors.push(`Asset name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`);
    } else if (DANGEROUS_CONFIG_RE.test(body.name)) {
      errors.push('Asset name must not contain markup tags');
    } else {
      data.name = body.name.trim();
    }
  } else if (!partial) {
    errors.push('Asset name is required');
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Asset description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`);
    } else if (DANGEROUS_CONFIG_RE.test(body.description)) {
      errors.push('Asset description must not contain markup tags');
    } else {
      data.description = body.description.trim();
    }
  } else if (!partial) {
    data.description = '';
  }

  if (body.asset_type !== undefined) {
    if (typeof body.asset_type !== 'string' || !CREATOR_ASSET_TYPES.has(body.asset_type)) {
      errors.push(`Unsupported asset type: ${String(body.asset_type)} (supported: ${[...CREATOR_ASSET_TYPES].join(', ')})`);
    } else {
      data.asset_type = body.asset_type;
    }
  } else if (!partial) {
    errors.push('Asset type is required');
  }

  if (body.asset_data !== undefined) {
    if (!jsonSafeValue(body.asset_data)) {
      errors.push('asset_data contains unsupported, unsafe or oversized values');
    } else {
      const type = data.asset_type || body.asset_type;
      if (type && CREATOR_ASSET_TYPES.has(type)) {
        const typeErrors = [];
        const validated = validateAssetData(type, body.asset_data, typeErrors);
        errors.push(...typeErrors);
        if (typeErrors.length === 0) data.asset_data = validated;
      } else if (!partial) {
        errors.push('asset_data cannot be validated without a valid asset_type');
      }
    }
  } else if (!partial) {
    errors.push('asset_data is required');
  }

  if (body.price_coins !== undefined) {
    if (!isFiniteNumber(body.price_coins) || !Number.isInteger(body.price_coins) || body.price_coins < 0 || body.price_coins > PRICE_COINS_MAX) {
      errors.push(`price_coins must be a non-negative integer between 0 and ${PRICE_COINS_MAX}`);
    } else {
      data.price_coins = body.price_coins;
    }
  } else if (!partial) {
    data.price_coins = 0;
  }

  // Optional provenance for profile_design assets; resolved+owned server-side.
  if (body.source_design_id !== undefined) {
    if (typeof body.source_design_id !== 'string' || !body.source_design_id.trim()) {
      errors.push('source_design_id must be a non-empty string when provided');
    } else {
      data.source_design_id = body.source_design_id;
    }
  }

  if (errors.length === 0 && data.asset_data !== undefined) {
    const bytes = Buffer.byteLength(JSON.stringify(data.asset_data));
    if (bytes > MAX_ASSET_BYTES) {
      errors.push(`asset_data must be at most ${MAX_ASSET_BYTES} bytes`);
    }
  }

  return { errors, data };
}

/**
 * Resolve + verify an optional source_design_id belongs to the same creator.
 * Returns the validated id or null; pushes an error when the reference is
 * missing, foreign or not a profile_design asset.
 */
function resolveSourceDesignId(userId, assetType, data, errors) {
  const id = data.source_design_id ?? null;
  if (!id) return id;
  if (assetType !== 'profile_design') {
    errors.push('source_design_id is only valid for profile_design assets');
    return null;
  }
  const design = queryOne(
    'SELECT id FROM profile_designs WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  if (!design) {
    errors.push('source_design_id must reference one of your own profile designs');
    return null;
  }
  return id;
}

/**
 * Serialize a persisted row into the API shape, parsing JSON columns and
 * re-running write-time validation so stored data can never be served broken.
 */
function serializeAssetRow(row) {
  if (!row) return null;
  if (typeof row.created_at !== 'string') return null;
  let assetData = null;
  try {
    assetData = JSON.parse(row.asset_data || '{}');
  } catch (e) {
    assetData = null;
  }
  let previewData = null;
  if (row.preview_data) {
    try {
      previewData = JSON.parse(row.preview_data);
    } catch (e) {
      previewData = null;
    }
  }
  if (!isPlainObject(assetData)) return null;
  const check = validateAssetPayload(
    { name: row.name, asset_type: row.asset_type, asset_data: assetData },
    { partial: true }
  );
  if (check.errors.length > 0) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    asset_type: row.asset_type,
    status: row.status,
    version: Number(row.version) || 1,
    preview_data: previewData,
    asset_data: assetData,
    price_coins: Number(row.price_coins) || 0,
    source_design_id: row.source_design_id || null,
    published_at: row.published_at || null,
    archived_at: row.archived_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ASSET_SELECT = `
  SELECT id, creator_user_id, name, description, asset_type, status, version,
         preview_data, asset_data, price_coins, source_design_id,
         published_at, archived_at, created_at, updated_at
  FROM creator_assets`;

function findOwnedAsset(id, userId) {
  return queryOne(`${ASSET_SELECT} WHERE id = ? AND creator_user_id = ?`, [id, userId]);
}

function findAsset(id) {
  return queryOne(`${ASSET_SELECT} WHERE id = ?`, [id]);
}

/** GET /api/creator/assets — list the authenticated creator's assets. */
export async function handleListAssets(req, res, user) {
  try {
    const rows = queryAll(
      `${ASSET_SELECT} WHERE creator_user_id = ? ORDER BY created_at DESC`,
      [user.sub]
    );
    jsonResponse(res, 200, { assets: rows.map(serializeAssetRow).filter(Boolean) });
  } catch (err) {
    console.error('[ASSET] List assets error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/creator/assets — create a draft asset owned by the caller. */
export async function handleCreateAsset(req, res, user) {
  try {
    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateAssetPayload(body);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    // Own an optional source design reference only after the validation above
    // has confirmed the type (profile_design), then persist the canonical row.
    let sourceDesignId = null;
    if (data.source_design_id) {
      const resolved = resolveSourceDesignId(user.sub, data.asset_type, data, errors);
      if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));
      sourceDesignId = resolved;
    }

    const previewData = derivePreviewData(data.asset_type, data.asset_data);
    const id = generateId();
    const ts = now();
    execute(
      `INSERT INTO creator_assets
         (id, creator_user_id, name, description, asset_type, status, version,
          preview_data, asset_data, price_coins, source_design_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)`,
      [
        id, user.sub, data.name, data.description, data.asset_type,
        JSON.stringify(previewData),
        JSON.stringify(data.asset_data),
        data.price_coins,
        sourceDesignId,
        ts, ts,
      ]
    );

    const created = findOwnedAsset(id, user.sub);
    jsonResponse(res, 201, { asset: serializeAssetRow(created) });
  } catch (err) {
    console.error('[ASSET] Create asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** GET /api/creator/assets/:id — read one of the authenticated creator's assets. */
export async function handleGetAsset(req, res, user, params) {
  try {
    const asset = findOwnedAsset(params.id, user.sub);
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    jsonResponse(res, 200, { asset: serializeAssetRow(asset) });
  } catch (err) {
    console.error('[ASSET] Get asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** PATCH /api/creator/assets/:id — edit a DRAFT asset only; ownership required. */
export async function handleUpdateAsset(req, res, user, params) {
  try {
    const existing = findOwnedAsset(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Asset not found');
    if (existing.status !== 'draft') {
      return errorResponse(res, 409, 'Only draft assets can be edited');
    }

    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateAssetPayload(body, { partial: true });
    if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));
    if (Object.keys(data).length === 0) return errorResponse(res, 400, 'Nothing to update');

    // Reject edits that would change the creator or skip the lifecycle.
    if (data.asset_type !== undefined && data.asset_type !== existing.asset_type) {
      return errorResponse(res, 409, 'Asset type cannot be changed after creation');
    }
    if (data.source_design_id !== undefined && data.asset_type !== 'profile_design') {
      return errorResponse(res, 400, 'source_design_id is only valid for profile_design assets');
    }

    let nextData = data.asset_data !== undefined
      ? data.asset_data
      : JSON.parse(existing.asset_data || '{}');
    let sourceDesignId = existing.source_design_id || null;
    if (data.source_design_id !== undefined) {
      const resolved = resolveSourceDesignId(user.sub, existing.asset_type, data, errors);
      if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));
      sourceDesignId = resolved;
    }

    const previewData = derivePreviewData(existing.asset_type, nextData);
    const ts = now();
    execute(
      `UPDATE creator_assets
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           asset_data = ?,
           preview_data = ?,
           price_coins = COALESCE(?, price_coins),
           source_design_id = ?,
           updated_at = ?
       WHERE id = ? AND creator_user_id = ?`,
      [
        data.name ?? null,
        data.description !== undefined ? data.description : null,
        JSON.stringify(nextData),
        JSON.stringify(previewData),
        data.price_coins !== undefined ? data.price_coins : null,
        sourceDesignId,
        ts, params.id, user.sub,
      ]
    );

    const updated = findOwnedAsset(params.id, user.sub);
    jsonResponse(res, 200, { asset: serializeAssetRow(updated) });
  } catch (err) {
    console.error('[ASSET] Update asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/creator/assets/:id/submit — draft -> submitted checkpoint.
 * Re-validates the complete stored asset so an invalid draft can never be
 * marked ready, then records the explicit content-complete state.
 */
export async function handleSubmitAsset(req, res, user, params) {
  try {
    const asset = findOwnedAsset(params.id, user.sub);
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    if (asset.status !== 'draft') {
      return errorResponse(res, 409, `Cannot submit an asset in status "${asset.status}"`);
    }

    const check = validateAssetPayload(
      { name: asset.name, asset_type: asset.asset_type, asset_data: JSON.parse(asset.asset_data || '{}') },
      { partial: true }
    );
    if (check.errors.length > 0) return errorResponse(res, 400, check.errors.join('; '));

    execute(
      `UPDATE creator_assets SET status = 'submitted', updated_at = ? WHERE id = ? AND creator_user_id = ?`,
      [now(), params.id, user.sub]
    );

    const updated = findOwnedAsset(params.id, user.sub);
    jsonResponse(res, 200, { asset: serializeAssetRow(updated) });
  } catch (err) {
    console.error('[ASSET] Submit asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/creator/assets/:id/publish — submitted -> published.
 * Publishing re-validates and bumps the version (each publish snapshots a new
 * version); published asset data is then immutable because edits are draft-only.
 *
 * CREATOR-02 implements no moderation workflow, so a validated submitted asset
 * is published directly by its creator, matching the existing profile-design
 * publish authorization model (no admin bypass, no fake review queue). A future
 * moderation milestone can gate this transition without schema changes.
 */
export async function handlePublishAsset(req, res, user, params) {
  try {
    const asset = findOwnedAsset(params.id, user.sub);
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    if (asset.status !== 'submitted') {
      return errorResponse(res, 409, `Only submitted assets can be published (current: "${asset.status}")`);
    }

    const check = validateAssetPayload(
      { name: asset.name, asset_type: asset.asset_type, asset_data: JSON.parse(asset.asset_data || '{}') },
      { partial: true }
    );
    if (check.errors.length > 0) return errorResponse(res, 400, check.errors.join('; '));

    const ts = now();
    execute(
      `UPDATE creator_assets
       SET status = 'published', version = version + 1, published_at = ?, updated_at = ?
       WHERE id = ? AND creator_user_id = ?`,
      [ts, ts, params.id, user.sub]
    );

    const updated = findOwnedAsset(params.id, user.sub);
    jsonResponse(res, 200, { asset: serializeAssetRow(updated) });
  } catch (err) {
    console.error('[ASSET] Publish asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/creator/assets/:id/archive — owner OR admin (existing requireAdmin
 * model) can retire an asset. Idempotent.
 */
export async function handleArchiveAsset(req, res, user, params) {
  try {
    const asset = findAsset(params.id);
    if (!asset) return errorResponse(res, 404, 'Asset not found');

    if (asset.creator_user_id !== user.sub) {
      const admin = requireAdmin(req, res);
      if (!admin) return;
    }

    const ts = now();
    execute(
      `UPDATE creator_assets SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE id = ?`,
      [ts, ts, params.id]
    );

    const updated = findOwnedAsset(params.id, asset.creator_user_id);
    jsonResponse(res, 200, { asset: serializeAssetRow(updated) });
  } catch (err) {
    console.error('[ASSET] Archive asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}