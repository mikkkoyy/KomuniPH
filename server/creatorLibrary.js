/**
 * KomuniPH Lite - Creator Studio Persistent Asset Library (CREATOR-16)
 *
 * A creator-scoped registry of reusable assets across projects. An item is a
 * REFERENCE to an existing asset (not a copy): the library stores the source
 * type + source id + lightweight metadata, so the original file/data is never
 * duplicated. The library persists across navigation, reloads, project switches,
 * and sign-in cycles, scoped to the authenticated creator.
 *
 * Supported source types:
 *   image          -> creator_media (a recorded upload from the existing pipeline)
 *   background     -> creator_assets asset_type='background'
 *   sticker        -> creator_assets asset_type='sticker'
 *   decoration     -> creator_assets asset_type='decoration'
 *   effect         -> creator_effects (published effects, referenced by effect_id)
 *   project        -> profile_designs (Creator Studio project)
 *   creator_asset  -> creator_assets (any published creator asset)
 *
 * Security:
 *   - ownership is always derived from the authenticated user (user.sub)
 *   - cross-user access returns 404
 *   - source ownership and status are validated before registration
 *   - a library entry is only ever a reference: removing one never
 *     touches the source system (files, projects, versions, effects,
 *     creator products)
 */

import { queryOne, queryAll, execute } from './database.js';
import { jsonResponse, errorResponse, parseBody, generateId, now } from './utils.js';
import { APP_IMAGE_URL_RE, DANGEROUS_CONFIG_RE, IMAGE_FITS } from './profileDesign.js';

export const LIBRARY_SOURCE_TYPES = new Set([
  'image',
  'background',
  'sticker',
  'decoration',
  'effect',
  'project',
  'creator_asset',
]);

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_PREVIEW_URL_LENGTH = 2048;

/** The only fields a client may ever set on a library item. */
const WRITABLE_FIELDS = new Set(['name', 'description', 'source_type', 'source_id', 'preview_url', 'metadata']);

async function readJsonBody(req, res) {
  try {
    return await parseBody(req);
  } catch (err) {
    errorResponse(res, 400, 'Invalid JSON request body');
    return null;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateMetadata(sourceType, metadata, errors) {
  if (!metadata || !isPlainObject(metadata)) return;
  const bytes = Buffer.byteLength(JSON.stringify(metadata));
  if (bytes > MAX_METADATA_BYTES) {
    errors.push(`metadata must be at most ${MAX_METADATA_BYTES} bytes`);
  }
  switch (sourceType) {
    case 'image':
    case 'background':
    case 'sticker':
    case 'decoration':
      if (metadata.fit !== undefined && !IMAGE_FITS.has(metadata.fit)) {
        errors.push(`metadata.fit must be one of: ${[...IMAGE_FITS].join(', ')}`);
      }
      break;
    case 'effect':
      if (metadata.engine !== undefined && typeof metadata.engine !== 'string') {
        errors.push('metadata.engine must be a string');
      }
      break;
    case 'project':
    case 'creator_asset':
      // No specific validation for these types
      break;
    default:
      break;
  }
}

export function validateLibraryItemPayload(body, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object'], data: null };
  }

  // Unsupported fields are rejected, never silently ignored — an update can
  // only ever touch the fields the library model actually has.
  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) {
      errors.push(`Unsupported field: ${key}`);
    }
  }

  const data = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > MAX_NAME_LENGTH) {
      errors.push(`Library item name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`);
    } else if (DANGEROUS_CONFIG_RE.test(body.name)) {
      errors.push('Library item name must not contain markup tags');
    } else {
      data.name = body.name.trim();
    }
  } else if (!partial) {
    errors.push('Library item name is required');
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Library item description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`);
    } else if (DANGEROUS_CONFIG_RE.test(body.description)) {
      errors.push('Library item description must not contain markup tags');
    } else {
      data.description = body.description.trim();
    }
  } else if (!partial) {
    data.description = '';
  }

  if (body.source_type !== undefined) {
    if (typeof body.source_type !== 'string' || !LIBRARY_SOURCE_TYPES.has(body.source_type)) {
      errors.push(`Unsupported source type: ${String(body.source_type)} (supported: ${[...LIBRARY_SOURCE_TYPES].join(', ')})`);
    } else {
      data.source_type = body.source_type;
    }
  } else if (!partial) {
    errors.push('Source type is required');
  }

  if (body.source_id !== undefined) {
    if (typeof body.source_id !== 'string' || !body.source_id.trim()) {
      errors.push('Source ID must be a non-empty string');
    } else {
      data.source_id = body.source_id.trim();
    }
  } else if (!partial) {
    errors.push('Source ID is required');
  }

  if (body.preview_url !== undefined) {
    if (body.preview_url !== null && body.preview_url !== '' && typeof body.preview_url !== 'string') {
      errors.push('Preview URL must be a string or null');
    } else {
      const preview = body.preview_url && body.preview_url.trim() ? body.preview_url.trim() : null;
      if (preview !== null && (preview.length > MAX_PREVIEW_URL_LENGTH || !APP_IMAGE_URL_RE.test(preview))) {
        errors.push('Preview URL must be a valid http(s) or /uploads/ image URL');
      } else {
        data.preview_url = preview;
      }
    }
  } else if (!partial) {
    data.preview_url = null;
  }

  if (body.metadata !== undefined) {
    if (body.metadata !== null && body.metadata !== '' && !isPlainObject(body.metadata)) {
      errors.push('Metadata must be an object or null');
    } else {
      data.metadata = body.metadata || null;
    }
  } else if (!partial) {
    data.metadata = null;
  }

  return { errors, data };
}

async function verifySourceOwnership(userId, sourceType, sourceId) {
  switch (sourceType) {
    case 'image':
      // creator_media: one row per successful upload, owned by the uploader.
      return queryOne(
        'SELECT id FROM creator_media WHERE id = ? AND creator_user_id = ?',
        [sourceId, userId]
      );
    case 'background':
    case 'sticker':
    case 'decoration':
      // The library source type maps 1:1 onto the creator_assets type, and
      // the asset must belong to the registering creator.
      return queryOne(
        'SELECT id FROM creator_assets WHERE id = ? AND creator_user_id = ? AND asset_type = ?',
        [sourceId, userId, sourceType]
      );
    case 'creator_asset':
      // A creator product reference points at the PUBLISHED product — the
      // same lifecycle state the public Coin Shop page serves.
      return queryOne(
        "SELECT id FROM creator_assets WHERE id = ? AND creator_user_id = ? AND status = 'published'",
        [sourceId, userId]
      );
    case 'effect':
      // Effects are referenced by their stable effect_id (what the design
      // theme stores and the Studio resolves), not the row id; only
      // published effects are selectable, matching the Studio's rules.
      return queryOne(
        "SELECT id FROM creator_effects WHERE effect_id = ? AND creator_user_id = ? AND status = 'published'",
        [sourceId, userId]
      );
    case 'project':
      return queryOne(
        'SELECT id FROM profile_designs WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        [sourceId, userId]
      );
    default:
      return null;
  }
}

function serializeLibraryItemRow(row) {
  if (!row) return null;
  let metadata = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    source_type: row.source_type,
    source_id: row.source_id,
    preview_url: row.preview_url || null,
    metadata: metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ITEM_SELECT = `
  SELECT id, creator_user_id, name, description, source_type, source_id,
         preview_url, metadata_json, created_at, updated_at
  FROM creator_library_items`;

function findOwnedItem(id, userId) {
  return queryOne(`${ITEM_SELECT} WHERE id = ? AND creator_user_id = ?`, [id, userId]);
}

function findItemBySource(userId, sourceType, sourceId) {
  return queryOne(
    `${ITEM_SELECT} WHERE creator_user_id = ? AND source_type = ? AND source_id = ?`,
    [userId, sourceType, sourceId]
  );
}

const LIBRARY_SORTS = new Set(['newest', 'oldest', 'name']);

/** Escape LIKE wildcards so a user query is matched literally. */
function likeParam(q) {
  return `%${String(q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function handleListLibraryItems(req, res, user) {
  try {
    const url = new URL(req.url, 'http://localhost');

    const sourceType = url.searchParams.get('source_type');
    const q = (url.searchParams.get('q') || '').trim();

    const parsedLimit = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 100);
    const parsedOffset = parseInt(url.searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    const sortRaw = url.searchParams.get('sort') || 'newest';
    const sort = LIBRARY_SORTS.has(sortRaw) ? sortRaw : 'newest';

    let where = 'WHERE creator_user_id = ?';
    const params = [user.sub];

    if (sourceType && LIBRARY_SOURCE_TYPES.has(sourceType)) {
      where += ' AND source_type = ?';
      params.push(sourceType);
    }

    if (q) {
      // Name or description contains the query (case-insensitive, literal).
      where += " AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
      params.push(likeParam(q), likeParam(q));
    }

    const totalRow = queryOne(
      `SELECT COUNT(*) AS total FROM creator_library_items ${where}`,
      params
    );
    const total = totalRow ? totalRow.total : 0;

    const orderBy =
      sort === 'oldest' ? 'created_at ASC, id ASC'
      : sort === 'name' ? 'name ASC, id ASC'
      : 'created_at DESC, id DESC';

    const rows = queryAll(
      `${ITEM_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    jsonResponse(res, 200, {
      items: rows.map(serializeLibraryItemRow).filter(Boolean),
      total,
      limit,
      offset,
      sort,
    });
  } catch (err) {
    console.error('[LIBRARY] List items error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleCreateLibraryItem(req, res, user) {
  try {
    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateLibraryItemPayload(body);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    const sourceOwned = await verifySourceOwnership(user.sub, data.source_type, data.source_id);
    if (!sourceOwned) {
      return errorResponse(res, 400, 'Source asset not found or not owned by you');
    }

    validateMetadata(data.source_type, data.metadata, errors);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    const existing = findItemBySource(user.sub, data.source_type, data.source_id);
    if (existing) {
      return errorResponse(res, 409, 'This asset is already in your library');
    }

    const id = generateId();
    const ts = now();
    execute(
      `INSERT INTO creator_library_items
         (id, creator_user_id, name, description, source_type, source_id, preview_url, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        user.sub,
        data.name,
        data.description,
        data.source_type,
        data.source_id,
        data.preview_url,
        data.metadata ? JSON.stringify(data.metadata) : null,
        ts,
        ts,
      ]
    );

    const created = findOwnedItem(id, user.sub);
    jsonResponse(res, 201, { item: serializeLibraryItemRow(created) });
  } catch (err) {
    console.error('[LIBRARY] Create item error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleGetLibraryItem(req, res, user, params) {
  try {
    const item = findOwnedItem(params.id, user.sub);
    if (!item) return errorResponse(res, 404, 'Library item not found');
    jsonResponse(res, 200, { item: serializeLibraryItemRow(item) });
  } catch (err) {
    console.error('[LIBRARY] Get item error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleUpdateLibraryItem(req, res, user, params) {
  try {
    const existing = findOwnedItem(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Library item not found');

    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateLibraryItemPayload(body, { partial: true });
    if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));
    if (Object.keys(data).length === 0) return errorResponse(res, 400, 'Nothing to update');

    if (data.source_type !== undefined && data.source_type !== existing.source_type) {
      return errorResponse(res, 409, 'Source type cannot be changed after creation');
    }
    if (data.source_id !== undefined && data.source_id !== existing.source_id) {
      return errorResponse(res, 409, 'Source ID cannot be changed after creation');
    }

    if (data.metadata !== undefined) {
      validateMetadata(existing.source_type, data.metadata, errors);
      if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));
    }

    // Fields the patch does not MENTION are preserved. Only an explicit
    // null (or '' for preview_url) clears an optional field — a rename
    // must never silently erase the preview or the stored metadata.
    const nextPreview = data.preview_url !== undefined ? data.preview_url : existing.preview_url;
    const nextMetadata = data.metadata !== undefined
      ? (data.metadata ? JSON.stringify(data.metadata) : null)
      : existing.metadata_json;

    const ts = now();
    execute(
      `UPDATE creator_library_items
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           preview_url = ?,
           metadata_json = ?,
           updated_at = ?
       WHERE id = ? AND creator_user_id = ?`,
      [
        data.name ?? null,
        data.description !== undefined ? data.description : null,
        nextPreview,
        nextMetadata,
        ts,
        params.id,
        user.sub,
      ]
    );

    const updated = findOwnedItem(params.id, user.sub);
    jsonResponse(res, 200, { item: serializeLibraryItemRow(updated) });
  } catch (err) {
    console.error('[LIBRARY] Update item error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleDeleteLibraryItem(req, res, user, params) {
  try {
    const existing = findOwnedItem(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Library item not found');

    execute('DELETE FROM creator_library_items WHERE id = ? AND creator_user_id = ?', [params.id, user.sub]);
    jsonResponse(res, 200, { success: true });
  } catch (err) {
    console.error('[LIBRARY] Delete item error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleBatchDeleteLibraryItems(req, res, user) {
  try {
    const body = await readJsonBody(req, res);
    if (body === null) return;
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return errorResponse(res, 400, 'ids array is required');
    }
    if (body.ids.length > 100) {
      return errorResponse(res, 400, 'Cannot delete more than 100 items at once');
    }
    if (body.ids.some(id => typeof id !== 'string' || !id.trim())) {
      return errorResponse(res, 400, 'ids must be non-empty strings');
    }

    const placeholders = body.ids.map(() => '?').join(',');
    execute(
      `DELETE FROM creator_library_items WHERE id IN (${placeholders}) AND creator_user_id = ?`,
      [...body.ids, user.sub]
    );

    jsonResponse(res, 200, { success: true });
  } catch (err) {
    console.error('[LIBRARY] Batch delete error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}