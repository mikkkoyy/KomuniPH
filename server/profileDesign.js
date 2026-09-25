/**
 * KomuniPH Lite - Profile Design Engine (CREATOR-01A)
 *
 * Foundation for user-authored profile layouts. A design is a controlled,
 * versioned snapshot: every component must be a registered type whose data
 * passes strict validation, and the server always derives ownership from the
 * authenticated user (user.sub) — never from the client.
 *
 * This milestone stores and validates the model and serves the published
 * design alongside public/own profiles. The visual drag-and-drop editor is a
 * separate, later milestone; clients that understand the layout can already
 * position the platform's existing controlled modules.
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { jsonResponse, errorResponse, parseBody, generateId, now } from './utils.js';
import { validateThemeConfig } from './profile.js';

/**
 * Controlled component types renderable on a profile. Each maps to an existing
 * KomuniPH profile section; content stays server-rendered and escaped, so the
 * design can only reposition/resize/visibility the section, never inject code.
 */
export const DESIGN_COMPONENT_TYPES = new Set([
  'profile_photo',
  'name',
  'alias',
  'bio',
  'personal_info',
  'gallery',
  'testimonials',
  'communities',
]);

/**
 * Recognized-but-unbuilt components. They are rejected today so a design can
 * never claim a layout the platform cannot render yet.
 */
export const FUTURE_COMPONENT_TYPES = new Set([
  'text', 'image', 'video', 'music', 'card', 'sticker', 'button',
  'visitor_counter', 'who_visited', 'decoration',
]);

// ── Validation constants ────────────────────────────────────────────────────
const MAX_COMPONENTS = 64;
const MAX_LAYOUT_BYTES = 512 * 1024;
const COMPONENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DANGEROUS_CONFIG_RE = /<\s*(script|iframe|object|embed|style)\b/i;

const POSITION_MIN = -10000;
const POSITION_MAX = 10000;
const SIZE_MIN = 8;
const SIZE_MAX = 4080;
const Z_INDEX_MAX = 10000;
const CANVAS_WIDTH_MIN = 320;
const CANVAS_WIDTH_MAX = 1920;
const CANVAS_MIN_HEIGHT_MIN = 480;
const CANVAS_MIN_HEIGHT_MAX = 10000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function jsonSafeValue(value, depth = 0) {
  if (value === null) return true;
  if (depth > 12) return false;
  const type = typeof value;
  if (type === 'string') return !DANGEROUS_CONFIG_RE.test(value);
  if (type === 'number') return Number.isFinite(value);
  if (type === 'boolean') return true;
  if (Array.isArray(value)) {
    if (value.length > 256) return false;
    return value.every(item => jsonSafeValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length > 32) return false;
    return Object.entries(value).every(([key, item]) =>
      typeof key === 'string' && key.length <= 64 && jsonSafeValue(item, depth + 1));
  }
  return false; // functions, symbols, etc.
}

function validateComponent(component, seenIds, errors) {
  if (!isPlainObject(component)) {
    errors.push('Each component must be an object');
    return;
  }

  const { id, type, x, y, width, height, zIndex, visible, locked, config } = component;

  if (typeof id !== 'string' || !COMPONENT_ID_RE.test(id)) {
    errors.push(`Component id must match ${COMPONENT_ID_RE} (got: ${id === undefined ? 'missing' : JSON.stringify(id)})`);
  } else if (seenIds.has(id)) {
    errors.push(`Duplicate component id: ${id}`);
  } else {
    seenIds.add(id);
  }

  if (typeof type !== 'string' || !DESIGN_COMPONENT_TYPES.has(type)) {
    const hint = typeof type === 'string' && FUTURE_COMPONENT_TYPES.has(type)
      ? ' — type is not renderable yet'
      : '';
    errors.push(`Unsupported component type: ${String(type)}${hint}`);
  }

  if (!isFiniteNumber(x) || x < POSITION_MIN || x > POSITION_MAX) {
    errors.push(`Component "${id}" x must be a number between ${POSITION_MIN} and ${POSITION_MAX}`);
  }
  if (!isFiniteNumber(y) || y < POSITION_MIN || y > POSITION_MAX) {
    errors.push(`Component "${id}" y must be a number between ${POSITION_MIN} and ${POSITION_MAX}`);
  }
  if (!isFiniteNumber(width) || width < SIZE_MIN || width > SIZE_MAX) {
    errors.push(`Component "${id}" width must be a number between ${SIZE_MIN} and ${SIZE_MAX}`);
  }
  if (!isFiniteNumber(height) || height < SIZE_MIN || height > SIZE_MAX) {
    errors.push(`Component "${id}" height must be a number between ${SIZE_MIN} and ${SIZE_MAX}`);
  }
  if (!Number.isInteger(zIndex) || zIndex < 0 || zIndex > Z_INDEX_MAX) {
    errors.push(`Component "${id}" zIndex must be an integer between 0 and ${Z_INDEX_MAX}`);
  }
  if (typeof visible !== 'boolean') {
    errors.push(`Component "${id}" visible must be a boolean`);
  }
  if (typeof locked !== 'boolean') {
    errors.push(`Component "${id}" locked must be a boolean`);
  }
  if (config !== null && config !== undefined && !isPlainObject(config)) {
    errors.push(`Component "${id}" config must be an object or null`);
  } else if (config !== null && config !== undefined && !jsonSafeValue(config)) {
    errors.push(`Component "${id}" config contains unsupported, unsafe or oversized values`);
  }
}

function validateLayoutConfig(layout) {
  const errors = [];
  if (layout === null || layout === undefined) return errors;

  if (!isPlainObject(layout)) {
    errors.push('layout_config must be an object');
    return errors;
  }

  const allowed = new Set(['canvas', 'components']);
  for (const key of Object.keys(layout)) {
    if (!allowed.has(key)) errors.push(`Unknown layout_config field: ${key}`);
  }

  if (layout.canvas !== undefined && layout.canvas !== null) {
    if (!isPlainObject(layout.canvas)) {
      errors.push('layout.canvas must be an object');
    } else {
      const { width, minHeight } = layout.canvas;
      if (!isFiniteNumber(width) || width < CANVAS_WIDTH_MIN || width > CANVAS_WIDTH_MAX) {
        errors.push(`layout.canvas.width must be a number between ${CANVAS_WIDTH_MIN} and ${CANVAS_WIDTH_MAX}`);
      }
      if (!isFiniteNumber(minHeight) || minHeight < CANVAS_MIN_HEIGHT_MIN || minHeight > CANVAS_MIN_HEIGHT_MAX) {
        errors.push(`layout.canvas.minHeight must be a number between ${CANVAS_MIN_HEIGHT_MIN} and ${CANVAS_MIN_HEIGHT_MAX}`);
      }
    }
  }

  if (layout.components !== undefined && layout.components !== null) {
    if (!Array.isArray(layout.components)) {
      errors.push('layout.components must be an array');
    } else if (layout.components.length > MAX_COMPONENTS) {
      errors.push(`A design supports at most ${MAX_COMPONENTS} components`);
    } else {
      const seenIds = new Set();
      layout.components.forEach(component => validateComponent(component, seenIds, errors));
    }
  }

  return errors;
}

/**
 * Validate + normalize a design payload.
 * Accepts a full body ({ name?, layout?, theme? }) or a partial patch.
 * Returns { errors, data } where data (when errors is empty) holds the
 * canonical NAME/LAYOUT/THEME values to persist.
 */
export function validateDesignPayload(body, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object'], data: null };
  }

  const data = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
      errors.push('Design name must be a non-empty string of at most 100 characters');
    } else if (DANGEROUS_CONFIG_RE.test(body.name)) {
      errors.push('Design name must not contain markup tags');
    } else {
      data.name = body.name.trim();
    }
  } else if (!partial) {
    errors.push('Design name is required');
  }

  if (body.layout !== undefined) {
    if (!isPlainObject(body.layout)) {
      errors.push('layout must be an object');
    } else {
      const layoutErrors = validateLayoutConfig(body.layout);
      errors.push(...layoutErrors);
      if (layoutErrors.length === 0) data.layout = body.layout;
    }
  } else if (!partial) {
    // A blank layout is a valid "everything default" design.
    data.layout = { canvas: null, components: [] };
  }

  if (body.theme !== undefined) {
    if (body.theme === null) {
      data.theme = null;
    } else if (!isPlainObject(body.theme)) {
      errors.push('theme must be an object or null');
    } else {
      const themeErrors = validateThemeConfig(body.theme);
      errors.push(...themeErrors);
      if (themeErrors.length === 0) data.theme = body.theme;
    }
  } else if (!partial) {
    data.theme = null;
  }

  if (errors.length === 0 && data.layout) {
    const bytes = Buffer.byteLength(JSON.stringify(data.layout));
    if (bytes > MAX_LAYOUT_BYTES) {
      errors.push(`layout_config must be at most ${MAX_LAYOUT_BYTES} bytes`);
    }
  }

  return { errors, data };
}

/**
 * Serialize a persisted design row into the API shape, parsing JSON columns.
 */
function serializeDesignRow(row) {
  if (!row) return null;
  if (typeof row.created_at !== 'string') return null; // guard against non-rows
  let layout = null;
  try {
    layout = JSON.parse(row.layout_config || '{}');
  } catch (e) {
    layout = null;
  }
  let theme = null;
  if (row.theme_config) {
    try {
      theme = JSON.parse(row.theme_config);
    } catch (e) {
      theme = null;
    }
  }
  if (layout === null || !isPlainObject(layout)) return null;
  // Re-run the exact write-time validation so stored data cannot break a profile.
  const check = validateDesignPayload({ name: row.name, layout, theme }, { partial: true });
  if (check.errors.length > 0) return null;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    version: Number(row.version) || 1,
    layout,
    theme,
    published_at: row.published_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findOwnedDesign(id, userId) {
  return queryOne(
    `SELECT id, user_id, name, status, version, layout_config, theme_config, published_at, created_at, updated_at
     FROM profile_designs WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

/**
 * Published design for a user id; null when absent or invalid.
 * Used to attach the design to own-profile responses.
 */
export function getPublishedDesignForUser(userId) {
  const row = queryOne(
    `SELECT id, user_id, name, status, version, layout_config, theme_config, published_at, created_at, updated_at
     FROM profile_designs WHERE user_id = ? AND status = 'published'
     ORDER BY published_at DESC LIMIT 1`,
    [userId]
  );
  return serializeDesignRow(row);
}

/**
 * Published design for a public username; null when absent or invalid.
 * Used to attach the design to public-profile responses without exposing user ids.
 */
export function getPublishedDesignByUsername(username) {
  const row = queryOne(
    `SELECT d.id, d.user_id, d.name, d.status, d.version, d.layout_config, d.theme_config, d.published_at, d.created_at, d.updated_at
     FROM profile_designs d
     JOIN profiles p ON p.user_id = d.user_id
     JOIN users u ON u.id = p.user_id
     WHERE u.username = ? AND d.status = 'published'
     ORDER BY d.published_at DESC LIMIT 1`,
    [username]
  );
  return serializeDesignRow(row);
}

async function readJsonBody(req, res) {
  try {
    return await parseBody(req);
  } catch (err) {
    errorResponse(res, 400, 'Invalid JSON request body');
    return null;
  }
}

/** GET /api/profile/design — list the authenticated user's designs. */
export async function handleListDesigns(req, res, user) {
  try {
    const rows = queryAll(
      `SELECT id, user_id, name, status, version, layout_config, theme_config, published_at, created_at, updated_at
       FROM profile_designs WHERE user_id = ? ORDER BY created_at DESC`,
      [user.sub]
    );
    jsonResponse(res, 200, { designs: rows.map(serializeDesignRow).filter(Boolean) });
  } catch (err) {
    console.error('[DESIGN] List designs error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/profile/design — create a draft design. Status is always forced to draft. */
export async function handleCreateDesign(req, res, user) {
  try {
    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateDesignPayload(body);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    const id = generateId();
    const ts = now();
    execute(
      `INSERT INTO profile_designs (id, user_id, name, status, version, layout_config, theme_config, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
      [id, user.sub, data.name, JSON.stringify(data.layout), data.theme ? JSON.stringify(data.theme) : null, ts, ts]
    );

    const created = findOwnedDesign(id, user.sub);
    jsonResponse(res, 201, { design: serializeDesignRow(created) });
  } catch (err) {
    console.error('[DESIGN] Create design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** GET /api/profile/design/:id — fetch one of the authenticated user's designs. */
export async function handleGetDesign(req, res, user, params) {
  try {
    const design = findOwnedDesign(params.id, user.sub);
    if (!design) return errorResponse(res, 404, 'Design not found');

    jsonResponse(res, 200, { design: serializeDesignRow(design) });
  } catch (err) {
    console.error('[DESIGN] Get design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** PATCH /api/profile/design/:id — update name/layout/theme of an owned design. */
export async function handleUpdateDesign(req, res, user, params) {
  try {
    const existing = findOwnedDesign(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Design not found');

    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateDesignPayload(body, { partial: true });
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }
    if (Object.keys(data).length === 0) {
      return errorResponse(res, 400, 'Nothing to update');
    }

    const ts = now();
    execute(
      `UPDATE profile_designs
       SET name = COALESCE(?, name),
           layout_config = COALESCE(?, layout_config),
           theme_config = COALESCE(?, theme_config),
           updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        data.name ?? null,
        data.layout !== undefined ? JSON.stringify(data.layout) : null,
        data.theme !== undefined ? (data.theme ? JSON.stringify(data.theme) : null) : null,
        ts,
        params.id,
        user.sub,
      ]
    );

    const updated = findOwnedDesign(params.id, user.sub);
    jsonResponse(res, 200, { design: serializeDesignRow(updated) });
  } catch (err) {
    console.error('[DESIGN] Update design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/profile/design/:id/publish — make this the user's live design.
 * Archives any previously published design (one published per user) and bumps
 * the version. Ownership comes from the authenticated user only.
 */
export async function handlePublishDesign(req, res, user, params) {
  try {
    const existing = findOwnedDesign(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Design not found');

    const ts = now();
    const version = Number(existing.version) + 1;
    transaction(() => {
      execute(
        `UPDATE profile_designs SET status = 'archived', updated_at = ?
         WHERE user_id = ? AND status = 'published' AND id <> ?`,
        [ts, user.sub, params.id]
      );
      execute(
        `UPDATE profile_designs SET status = 'published', published_at = ?, version = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [ts, version, ts, params.id, user.sub]
      );
    });

    const updated = findOwnedDesign(params.id, user.sub);
    jsonResponse(res, 200, { design: serializeDesignRow(updated) });
  } catch (err) {
    console.error('[DESIGN] Publish design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/profile/design/:id/archive — take the design out of rotation. */
export async function handleArchiveDesign(req, res, user, params) {
  try {
    const existing = findOwnedDesign(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Design not found');

    const ts = now();
    execute(
      `UPDATE profile_designs SET status = 'archived', updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [ts, params.id, user.sub]
    );

    const updated = findOwnedDesign(params.id, user.sub);
    jsonResponse(res, 200, { design: serializeDesignRow(updated) });
  } catch (err) {
    console.error('[DESIGN] Archive design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}