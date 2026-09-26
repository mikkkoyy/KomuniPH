/**
 * KomuniPH Lite - Profile Design Engine (CREATOR-01A)
 *
 * Foundation for user-authored profile layouts. A design is a controlled,
 * versioned snapshot: every component must be a registered type whose data
 * passes strict validation, and the server always derives ownership from the
 * authenticated user (user.sub) — never from the client.
 *
 * CREATOR-01A stored and validated the model and served the published design
 * alongside public/own profiles. CREATOR-01B added the visual Creator Studio
 * editor plus four user-content component types (text / image / card /
 * sticker) with strict per-type config, per-component style and rotation.
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { jsonResponse, errorResponse, parseBody, generateId, now } from './utils.js';
import { validateThemeConfig } from './profile.js';

/**
 * Controlled component types renderable on a profile. Each maps to an existing
 * KomuniPH profile section; content stays server-rendered and escaped, so the
 * design can only reposition/resize/visibility the section, never inject code.
 * CREATOR-01B added the four user-content types below; those carry a strict
 * per-type config and are rendered by the client renderer (never server HTML).
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
  'text',
  'image',
  'card',
  'sticker',
]);

/**
 * Recognized-but-unbuilt components. They are rejected today so a design can
 * never claim a layout the platform cannot render yet.
 */
export const FUTURE_COMPONENT_TYPES = new Set([
  'video', 'music', 'button',
  'visitor_counter', 'who_visited', 'decoration',
]);

// ── Validation constants ────────────────────────────────────────────────────
const MAX_COMPONENTS = 64;
const MAX_LAYOUT_BYTES = 512 * 1024;
const COMPONENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const DANGEROUS_CONFIG_RE = /<\s*(script|iframe|object|embed|style)\b/i;

const POSITION_MIN = -10000;
const POSITION_MAX = 10000;
const SIZE_MIN = 8;
const SIZE_MAX = 4080;
const Z_INDEX_MAX = 10000;
const CANVAS_WIDTH_MIN = 320;
const CANVAS_WIDTH_MAX = 1920;
const CANVAS_MIN_HEIGHT_MIN = 480;
const CANVAS_MIN_HEIGHT_MAX = 10000;

// ── CREATOR-01B per-component style & rotation limits ────────────────────────
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;

// An empty string means "inherit the platform default" for that property.
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const isCssColor = value => value === '' || /^#[0-9a-fA-F]{3,8}$/.test(value);

const STYLE_FIELDS = new Set([
  'background', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
  'opacity', 'shadowEnabled', 'shadowOffset', 'shadowBlur', 'shadowColor',
]);
const BORDER_WIDTH_MAX = 100;
const BORDER_RADIUS_MAX = 500;
const SHADOW_OFFSET_MAX = 100;
const SHADOW_BLUR_MAX = 200;

// ── CREATOR-01B per-type content config limits ───────────────────────────────
const TEXT_MAX = 2000;
const HEADING_MAX = 200;
const ALT_MAX = 200;
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const IMAGE_FITS = new Set(['cover', 'contain', 'fill']);
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 200;
const FONT_WEIGHT_MIN = 100;
const FONT_WEIGHT_MAX = 900;
const LINE_HEIGHT_MIN = 0.5;
const LINE_HEIGHT_MAX = 3;

// Content types accept only http(s) image URLs — never data:, javascript: or
// any scheme that could smuggle script or bypass the render-time img element.
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const HTTP_URL_RE = /^https?:\/\/[^\s'"<>]+$/i;

const CONTENT_TYPE_CONFIG_FIELDS = {
  text: new Set(['text', 'fontSize', 'fontWeight', 'textAlign', 'lineHeight', 'textColor']),
  image: new Set(['imageUrl', 'alt', 'fit', 'backgroundColor']),
  sticker: new Set(['imageUrl', 'alt', 'fit', 'backgroundColor']),
  card: new Set(['heading', 'body', 'headingColor', 'textAlign', 'textColor']),
};

// CREATOR-02: exported for reuse by creatorAssets.js validation.
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function jsonSafeValue(value, depth = 0) {
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

/**
 * CREATOR-01B: rotation + per-component style (background / typography color /
 * border / radius / opacity / shadow), all optional with safe defaults.
 */
function validateComponentRotateStyle(component, errors) {
  const { id, rotation, style } = component;

  if (rotation !== undefined && (!isFiniteNumber(rotation) || rotation < ROTATION_MIN || rotation > ROTATION_MAX)) {
    errors.push(`Component "${id}" rotation must be a number between ${ROTATION_MIN} and ${ROTATION_MAX}`);
  }

  if (style === null || style === undefined) return;
  if (!isPlainObject(style)) {
    errors.push(`Component "${id}" style must be an object or null`);
    return;
  }

  for (const key of Object.keys(style)) {
    if (!STYLE_FIELDS.has(key)) errors.push(`Component "${id}" style has unknown field: ${key}`);
  }

  if (style.background !== undefined && !isCssColor(style.background)) errors.push(`Component "${id}" style.background must be a hex color or empty`);
  if (style.textColor !== undefined && !isCssColor(style.textColor)) errors.push(`Component "${id}" style.textColor must be a hex color or empty`);
  if (style.borderColor !== undefined && !isCssColor(style.borderColor)) errors.push(`Component "${id}" style.borderColor must be a hex color or empty`);
  if (style.shadowColor !== undefined && !isCssColor(style.shadowColor)) errors.push(`Component "${id}" style.shadowColor must be a hex color or empty`);

  if (style.borderWidth !== undefined && (!isFiniteNumber(style.borderWidth) || style.borderWidth < 0 || style.borderWidth > BORDER_WIDTH_MAX)) {
    errors.push(`Component "${id}" style.borderWidth must be a number between 0 and ${BORDER_WIDTH_MAX}`);
  }
  if (style.borderRadius !== undefined && (!isFiniteNumber(style.borderRadius) || style.borderRadius < 0 || style.borderRadius > BORDER_RADIUS_MAX)) {
    errors.push(`Component "${id}" style.borderRadius must be a number between 0 and ${BORDER_RADIUS_MAX}`);
  }
  if (style.opacity !== undefined && (!isFiniteNumber(style.opacity) || style.opacity < 0 || style.opacity > 1)) {
    errors.push(`Component "${id}" style.opacity must be a number between 0 and 1`);
  }
  if (style.shadowOffset !== undefined && (!isFiniteNumber(style.shadowOffset) || style.shadowOffset < -SHADOW_OFFSET_MAX || style.shadowOffset > SHADOW_OFFSET_MAX)) {
    errors.push(`Component "${id}" style.shadowOffset must be a number between ${-SHADOW_OFFSET_MAX} and ${SHADOW_OFFSET_MAX}`);
  }
  if (style.shadowBlur !== undefined && (!isFiniteNumber(style.shadowBlur) || style.shadowBlur < 0 || style.shadowBlur > SHADOW_BLUR_MAX)) {
    errors.push(`Component "${id}" style.shadowBlur must be a number between 0 and ${SHADOW_BLUR_MAX}`);
  }
  if (style.shadowEnabled !== undefined && typeof style.shadowEnabled !== 'boolean') {
    errors.push(`Component "${id}" style.shadowEnabled must be a boolean`);
  }
}

/**
 * CREATOR-01B: strict per-type config for text / image / card / sticker.
 * The controlled sections keep a freeish (but json-safe) config that the
 * renderer ignores; content types get an exact field contract so stored
 * payloads always map to what the renderer can display.
 */
function validateContentConfig(component, errors) {
  const { id, type, config } = component;
  if (type !== 'text' && type !== 'image' && type !== 'card' && type !== 'sticker') return;

  if (config === null || config === undefined) {
    errors.push(`Component "${id}" is a ${type} and requires a config object`);
    return;
  }
  if (!isPlainObject(config)) return; // shape errors already reported

  const allowed = CONTENT_TYPE_CONFIG_FIELDS[type];
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) errors.push(`Component "${id}" config has unknown field: ${key}`);
  }

  if (type === 'text') {
    const text = config.text;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > TEXT_MAX) {
      errors.push(`Component "${id}" config.text must be a non-empty string of at most ${TEXT_MAX} characters`);
    } else if (config.text !== text.trim()) {
      errors.push(`Component "${id}" config.text must not have leading/trailing whitespace`);
    }
    if (config.fontSize !== undefined && (!isFiniteNumber(config.fontSize) || config.fontSize < FONT_SIZE_MIN || config.fontSize > FONT_SIZE_MAX)) {
      errors.push(`Component "${id}" config.fontSize must be a number between ${FONT_SIZE_MIN} and ${FONT_SIZE_MAX}`);
    }
    if (config.fontWeight !== undefined && (!Number.isInteger(config.fontWeight) || config.fontWeight < FONT_WEIGHT_MIN || config.fontWeight > FONT_WEIGHT_MAX)) {
      errors.push(`Component "${id}" config.fontWeight must be an integer between ${FONT_WEIGHT_MIN} and ${FONT_WEIGHT_MAX}`);
    }
    if (config.textAlign !== undefined && !TEXT_ALIGNS.has(config.textAlign)) {
      errors.push(`Component "${id}" config.textAlign must be one of: ${[...TEXT_ALIGNS].join(', ')}`);
    }
    if (config.lineHeight !== undefined && (!isFiniteNumber(config.lineHeight) || config.lineHeight < LINE_HEIGHT_MIN || config.lineHeight > LINE_HEIGHT_MAX)) {
      errors.push(`Component "${id}" config.lineHeight must be a number between ${LINE_HEIGHT_MIN} and ${LINE_HEIGHT_MAX}`);
    }
    if (config.textColor !== undefined && !isCssColor(config.textColor)) {
      errors.push(`Component "${id}" config.textColor must be a hex color or empty`);
    }
  }

  if (type === 'image' || type === 'sticker') {
    const url = config.imageUrl;
    if (typeof url !== 'string' || !HTTP_URL_RE.test(url)) {
      errors.push(`Component "${id}" config.imageUrl must be a valid http(s) image URL`);
    }
    if (config.alt !== undefined && (typeof config.alt !== 'string' || config.alt.length > ALT_MAX)) {
      errors.push(`Component "${id}" config.alt must be a string of at most ${ALT_MAX} characters`);
    }
    if (config.fit !== undefined && !IMAGE_FITS.has(config.fit)) {
      errors.push(`Component "${id}" config.fit must be one of: ${[...IMAGE_FITS].join(', ')}`);
    }
    if (config.backgroundColor !== undefined && !isCssColor(config.backgroundColor)) {
      errors.push(`Component "${id}" config.backgroundColor must be a hex color or empty`);
    }
  }

  if (type === 'card') {
    const heading = config.heading;
    if (typeof heading !== 'string' || !heading.trim() || heading.trim().length > HEADING_MAX) {
      errors.push(`Component "${id}" config.heading must be a non-empty string of at most ${HEADING_MAX} characters`);
    } else if (config.heading !== heading.trim()) {
      errors.push(`Component "${id}" config.heading must not have leading/trailing whitespace`);
    }
    if (config.body !== undefined && (typeof config.body !== 'string' || config.body.length > TEXT_MAX)) {
      errors.push(`Component "${id}" config.body must be a string of at most ${TEXT_MAX} characters`);
    }
    if (config.headingColor !== undefined && !isCssColor(config.headingColor)) {
      errors.push(`Component "${id}" config.headingColor must be a hex color or empty`);
    }
    if (config.textColor !== undefined && !isCssColor(config.textColor)) {
      errors.push(`Component "${id}" config.textColor must be a hex color or empty`);
    }
    if (config.textAlign !== undefined && !TEXT_ALIGNS.has(config.textAlign)) {
      errors.push(`Component "${id}" config.textAlign must be one of: ${[...TEXT_ALIGNS].join(', ')}`);
    }
  }
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

  // CREATOR-01B: rotation + style are optional; when present they must be sane.
  validateComponentRotateStyle(component, errors);
  validateContentConfig(component, errors);
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