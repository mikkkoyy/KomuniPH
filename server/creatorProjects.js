/**
 * KomuniPH Lite - Creator Studio Project Manager (CREATOR-14)
 *
 * A Creator Studio project IS a profile_designs row. This module provides
 * the project management API layered on top of the existing design table:
 *   - list projects (active + archived, excluding soft-deleted)
 *   - get project by id
 *   - create project (with valid default design)
 *   - rename project
 *   - duplicate project
 *   - archive project
 *   - restore project
 *   - delete project (soft-delete; only archived projects)
 *
 * Ownership is always derived from the authenticated user (user.sub).
 * Cross-user access returns 404.
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { jsonResponse, errorResponse, parseBody, generateId, now } from './utils.js';
import { validateDesignPayload } from './profileDesign.js';

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * The default canvas for a brand-new project. Matches the real profile
 * layout the Studio draws (960x1200), so a new project opens on the
 * same canvas the creator edits in.
 */
const DEFAULT_CANVAS = { width: 960, minHeight: 1200 };

/**
 * Serialize a profile_designs row into the project API shape.
 * Reuses the design serializer's JSON parsing but presents project-focused fields.
 */
function serializeProjectRow(row) {
  if (!row) return null;
  if (typeof row.created_at !== 'string') return null;

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
  if (layout === null || typeof layout !== 'object') return null;

  // Re-validate so stored data cannot break the Studio
  const check = validateDesignPayload({ name: row.name, layout, theme }, { partial: true });
  if (check.errors.length > 0) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    thumbnail_url: row.thumbnail_url || null,
    status: row.status, // 'draft' | 'published' | 'archived'
    version: Number(row.version) || 1,
    layout,
    theme,
    archived_at: row.archived_at || null,
    deleted_at: row.deleted_at || null,
    published_at: row.published_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Find a project owned by the user, excluding soft-deleted rows.
 */
function findOwnedProject(id, userId) {
  return queryOne(
    `SELECT id, user_id, name, status, version, layout_config, theme_config,
        description, thumbnail_url, archived_at, deleted_at,
        published_at, created_at, updated_at
      FROM profile_designs WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId]
  );
}

/**
 * List all projects for a user (active + archived), excluding soft-deleted.
 * Ordered by updated_at DESC so the most recently touched project is first.
 */
function listOwnedProjects(userId) {
  return queryAll(
    `SELECT id, user_id, name, status, version, layout_config, theme_config,
        description, thumbnail_url, archived_at, deleted_at,
        published_at, created_at, updated_at
      FROM profile_designs WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC`,
    [userId]
  );
}

/**
 * Create a new project with a valid default design.
 */
export async function handleCreateProject(req, res, user) {
  try {
    const body = await parseBody(req);
    if (!body) return;

    const { errors, data } = validateCreateProjectPayload(body);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    const id = generateId();
    const ts = now();

    // A valid default layout: the real profile canvas with no components.
    // The Profile Guide is initialised by the Studio when the project is
    // opened (see normalizeDesign/ensureGuideInitialized in the frontend),
    // exactly as it is for designs created through the design API.
    const defaultLayout = {
      canvas: { ...DEFAULT_CANVAS },
      components: [],
    };

    transaction(() => {
      execute(
        `INSERT INTO profile_designs
           (id, user_id, name, description, status, version, layout_config, theme_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
        [id, user.sub, data.name.trim(), data.description.trim(), JSON.stringify(defaultLayout), null, ts, ts]
      );
      // CREATOR-15: the creation state IS version 1, so the version
      // history is complete from the very first save onward and the
      // invariant "current version == highest saved version" holds
      // everywhere, for every project, from every creation path.
      execute(
        `INSERT INTO profile_design_versions
           (id, design_id, user_id, version, name, description, status,
            layout_config, theme_config, thumbnail_url, restored_from_version, created_at)
         VALUES (?, ?, ?, 1, ?, ?, 'draft', ?, NULL, NULL, NULL, ?)`,
        [generateId(), id, user.sub, data.name.trim(), data.description.trim(), JSON.stringify(defaultLayout), ts]
      );
    });

    const created = findOwnedProject(id, user.sub);
    jsonResponse(res, 201, { project: serializeProjectRow(created) });
  } catch (err) {
    console.error('[PROJECT] Create project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Validate create project payload.
 */
function validateCreateProjectPayload(body) {
  const errors = [];
  const data = {};

  if (!body || typeof body !== 'object') {
    return { errors: ['Request body must be a JSON object'], data: null };
  }

  if (body.name === undefined || body.name === null) {
    errors.push('Project name is required');
  } else if (typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('Project name must be a non-empty string');
  } else if (body.name.trim().length > MAX_NAME_LENGTH) {
    errors.push(`Project name must be at most ${MAX_NAME_LENGTH} characters`);
  } else if (/<\s*(script|iframe|object|embed|style)\b/i.test(body.name)) {
    errors.push('Project name must not contain markup tags');
  } else {
    data.name = body.name.trim();
  }

  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') {
      errors.push('Description must be a string');
    } else if (body.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    } else {
      data.description = body.description.trim();
    }
  } else {
    data.description = '';
  }

  return { errors, data };
}

/**
 * GET /api/creator/projects — list the authenticated user's projects.
 */
export async function handleListProjects(req, res, user) {
  try {
    const rows = listOwnedProjects(user.sub);
    jsonResponse(res, 200, { projects: rows.map(serializeProjectRow).filter(Boolean) });
  } catch (err) {
    console.error('[PROJECT] List projects error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/creator/projects/:id — fetch one of the authenticated user's projects.
 */
export async function handleGetProject(req, res, user, params) {
  try {
    const project = findOwnedProject(params.id, user.sub);
    if (!project) return errorResponse(res, 404, 'Project not found');

    jsonResponse(res, 200, { project: serializeProjectRow(project) });
  } catch (err) {
    console.error('[PROJECT] Get project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * PATCH /api/creator/projects/:id — rename or update description.
 */
export async function handleUpdateProject(req, res, user, params) {
  try {
    const existing = findOwnedProject(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    const body = await parseBody(req);
    if (body === null) return;

    const { errors, data } = validateUpdateProjectPayload(body, existing);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }
    if (Object.keys(data).length === 0) {
      return errorResponse(res, 400, 'Nothing to update');
    }

    const ts = now();
    const setParts = [];
    const values = [];

    if (data.name !== undefined) {
      setParts.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      setParts.push('description = ?');
      values.push(data.description);
    }
    setParts.push('updated_at = ?');
    values.push(ts);
    values.push(params.id);
    values.push(user.sub);

    execute(
      `UPDATE profile_designs SET ${setParts.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      values
    );

    const updated = findOwnedProject(params.id, user.sub);
    jsonResponse(res, 200, { project: serializeProjectRow(updated) });
  } catch (err) {
    console.error('[PROJECT] Update project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

function validateUpdateProjectPayload(body, existing) {
  const errors = [];
  const data = {};

  if (!body || typeof body !== 'object') {
    return { errors: ['Request body must be a JSON object'], data: null };
  }

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      errors.push('Project name must be a non-empty string');
    } else if (body.name.trim().length > MAX_NAME_LENGTH) {
      errors.push(`Project name must be at most ${MAX_NAME_LENGTH} characters`);
    } else if (/<\s*(script|iframe|object|embed|style)\b/i.test(body.name)) {
      errors.push('Project name must not contain markup tags');
    } else if (body.name.trim() !== existing.name) {
      data.name = body.name.trim();
    }
  }

  if (body.description !== undefined) {
    if (body.description === null) {
      data.description = '';
    } else if (typeof body.description !== 'string') {
      errors.push('Description must be a string');
    } else if (body.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    } else if (body.description.trim() !== (existing.description || '')) {
      data.description = body.description.trim();
    }
  }

  return { errors, data };
}

/**
 * POST /api/creator/projects/:id/duplicate — create an independent copy.
 */
export async function handleDuplicateProject(req, res, user, params) {
  try {
    const id = params.id;

    const existing = findOwnedProject(id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    const newId = generateId();
    const ts = now();

    // Deep-clone layout and theme to ensure complete independence
    let layout = {};
    let theme = null;
    try {
      layout = JSON.parse(existing.layout_config || '{}');
    } catch (e) {
      layout = { canvas: { ...DEFAULT_CANVAS }, components: [] };
    }
    if (existing.theme_config) {
      try {
        theme = JSON.parse(existing.theme_config);
      } catch (e) {
        theme = null;
      }
    }

    // Generate a new name
    const baseName = existing.name;
    let newName = `${baseName} Copy`;
    // Ensure uniqueness by checking existing names
    const nameCheck = queryOne(
      `SELECT 1 FROM profile_designs WHERE user_id = ? AND name = ? AND deleted_at IS NULL`,
      [user.sub, newName]
    );
    if (nameCheck) {
      newName = `${baseName} Copy ${Date.now().toString(36)}`;
    }

    execute(
      `INSERT INTO profile_designs
         (id, user_id, name, description, status, version, layout_config, theme_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
      [newId, user.sub, newName, existing.description || '', JSON.stringify(layout), theme ? JSON.stringify(theme) : null, ts, ts]
    );
    // CREATOR-15: the duplicate is an independent project whose creation
    // state (the cloned layout) is its version 1. Its history starts
    // fresh — it does not inherit the source project's versions.
    execute(
      `INSERT INTO profile_design_versions
         (id, design_id, user_id, version, name, description, status,
          layout_config, theme_config, thumbnail_url, restored_from_version, created_at)
       VALUES (?, ?, ?, 1, ?, ?, 'draft', ?, ?, NULL, NULL, ?)`,
      [generateId(), newId, user.sub, newName, existing.description || '',
       JSON.stringify(layout), theme ? JSON.stringify(theme) : null, ts]
    );

    const created = findOwnedProject(newId, user.sub);
    jsonResponse(res, 201, { project: serializeProjectRow(created) });
  } catch (err) {
    console.error('[PROJECT] Duplicate project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/creator/projects/:id/archive — archive a project.
 * Sets status = 'archived' and archived_at = timestamp.
 */
export async function handleArchiveProject(req, res, user, params) {
  try {
    const id = params.id;

    const existing = findOwnedProject(id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    if (existing.status === 'archived') {
      return errorResponse(res, 400, 'Project is already archived');
    }

    const ts = now();
    execute(
      `UPDATE profile_designs SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [ts, ts, id, user.sub]
    );

    const updated = findOwnedProject(id, user.sub);
    jsonResponse(res, 200, { project: serializeProjectRow(updated) });
  } catch (err) {
    console.error('[PROJECT] Archive project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/creator/projects/:id/restore — restore an archived project.
 * Sets status = 'draft' and archived_at = NULL.
 */
export async function handleRestoreProject(req, res, user, params) {
  try {
    const id = params.id;

    const existing = findOwnedProject(id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    if (existing.status !== 'archived') {
      return errorResponse(res, 400, 'Only archived projects can be restored');
    }

    const ts = now();
    execute(
      `UPDATE profile_designs SET status = 'draft', archived_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [ts, id, user.sub]
    );

    const updated = findOwnedProject(id, user.sub);
    jsonResponse(res, 200, { project: serializeProjectRow(updated) });
  } catch (err) {
    console.error('[PROJECT] Restore project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * DELETE /api/creator/projects/:id — soft-delete a project.
 * Only archived projects can be deleted. Sets deleted_at = timestamp.
 */
export async function handleDeleteProject(req, res, user, params) {
  try {
    const id = params.id;

    const existing = findOwnedProject(id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    if (existing.status !== 'archived') {
      return errorResponse(res, 400, 'Only archived projects can be deleted. Archive the project first.');
    }

    const ts = now();
    execute(
      `UPDATE profile_designs SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [ts, ts, id, user.sub]
    );

    jsonResponse(res, 200, { success: true });
  } catch (err) {
    console.error('[PROJECT] Delete project error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

// ── CREATOR-15: Version History ─────────────────────────────────────────
//
// A version is an immutable snapshot of a design's name, layout and theme.
// Saving appends a new row; restoring an old version appends a NEW row that
// copies the old contents. History is append-only: no row is ever updated
// or deleted, so every version a creator has saved stays exactly as saved.

/**
 * Canonical JSON with recursively sorted keys. Two payloads that differ
 * only in key order compare equal, so "did the design change?" is a
 * question about MEANING, never about byte order or timestamps.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

/**
 * Fingerprint of a persisted design row's state. Used for the deterministic
 * no-change detection: a re-save of identical content writes nothing.
 */
function designFingerprint(row) {
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
  return canonicalJson({ name: row.name, layout, theme });
}

/**
 * Serialize a profile_design_versions row. Re-validates the stored
 * layout/theme so a stored snapshot can never break a consumer.
 */
function serializeVersionRow(row) {
  if (!row) return null;
  let layout = null;
  try {
    layout = JSON.parse(row.layout_config || '{}');
  } catch (e) {
    return null;
  }
  let theme = null;
  if (row.theme_config) {
    try {
      theme = JSON.parse(row.theme_config);
    } catch (e) {
      theme = null;
    }
  }
  if (layout === null || typeof layout !== 'object') return null;
  const check = validateDesignPayload({ name: row.name, layout, theme }, { partial: true });
  if (check.errors.length > 0) return null;

  return {
    version: Number(row.version),
    name: row.name,
    description: row.description || '',
    status: row.status,
    layout,
    theme,
    thumbnail_url: row.thumbnail_url || null,
    restored_from_version:
      row.restored_from_version === null || row.restored_from_version === undefined
        ? null
        : Number(row.restored_from_version),
    created_at: row.created_at,
  };
}

function listDesignVersions(designId) {
  return queryAll(
    `SELECT version, name, description, status, thumbnail_url, restored_from_version, created_at
     FROM profile_design_versions WHERE design_id = ? ORDER BY version DESC`,
    [designId]
  );
}

/**
 * Serialize a history LIST entry: metadata only. The full
 * layout/theme of a version is fetched per-version, so the
 * list stays cheap and never carries a design payload.
 */
function serializeVersionSummary(row) {
  if (!row) return null;
  return {
    version: Number(row.version),
    name: row.name,
    description: row.description || '',
    status: row.status,
    thumbnail_url: row.thumbnail_url || null,
    restored_from_version:
      row.restored_from_version === null || row.restored_from_version === undefined
        ? null
        : Number(row.restored_from_version),
    created_at: row.created_at,
  };
}

function findDesignVersion(designId, version) {
  return queryOne(
    `SELECT version, name, description, status, layout_config, theme_config,
            thumbnail_url, restored_from_version, created_at
     FROM profile_design_versions WHERE design_id = ? AND version = ?`,
    [designId, version]
  );
}

/**
 * The next version number for a design. The server is the only authority:
 * it is always one above the highest version the design has ever saved,
 * so a version number can never be reused, decremented or supplied by a
 * client. The MAX() guard keeps the number collision-free even if a
 * design row's version ever drifted below its highest saved version.
 */
function nextVersionFor(designId, currentVersion) {
  const row = queryOne(
    `SELECT MAX(version) AS max_version FROM profile_design_versions WHERE design_id = ?`,
    [designId]
  );
  const maxSaved = Number(row && row.max_version) || 0;
  return Math.max(Number(currentVersion) || 0, maxSaved) + 1;
}

/**
 * Write a version row and update the current design row in one
 * transaction, so the version history and the current state can never
 * disagree (an atomic save).
 */
function writeVersion(designId, userId, version, name, description, status, layout, theme, thumbnailUrl, restoredFrom, ts) {
  transaction(() => {
    execute(
      `INSERT INTO profile_design_versions
         (id, design_id, user_id, version, name, description, status,
          layout_config, theme_config, thumbnail_url, restored_from_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [generateId(), designId, userId, version, name, description, status,
       JSON.stringify(layout), theme ? JSON.stringify(theme) : null,
       thumbnailUrl || null, restoredFrom, ts]
    );
    execute(
      `UPDATE profile_designs
       SET name = ?, layout_config = ?, theme_config = ?, version = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [name, JSON.stringify(layout), theme ? JSON.stringify(theme) : null, version, ts, designId, userId]
    );
  });
}

/**
 * POST /api/creator/projects/:id/save — explicit Save.
 *
 * Validates the FULL design payload (name + layout + theme), then compares
 * it against the persisted state with a canonical fingerprint. An unchanged
 * design creates NO new version. A changed design writes a new immutable
 * version and updates the current design atomically.
 */
export async function handleSaveProjectVersion(req, res, user, params) {
  try {
    const existing = findOwnedProject(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    const body = await parseBody(req);
    if (body === null) return;

    // A save is a full snapshot: layout and theme are
    // required explicitly. The shared validator treats a
    // MISSING layout as "blank design" and a missing
    // theme as null (the create contract); a save must
    // never silently blank a project or drop its theme,
    // so both keys must be present. An explicit
    // `theme: null` ("no theme") is a valid value.
    if (body.layout === undefined || body.theme === undefined) {
      return errorResponse(res, 400, 'layout and theme are required');
    }

    const { errors, data } = validateDesignPayload(body, { partial: false });
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    // Deterministic no-change detection. Timestamps are never consulted:
    // re-saving identical content is a no-op even though updated_at
    // would otherwise differ.
    const incoming = canonicalJson({ name: data.name, layout: data.layout, theme: data.theme });
    if (incoming === designFingerprint(existing)) {
      return jsonResponse(res, 200, {
        project: serializeProjectRow(existing),
        saved: false,
        version: Number(existing.version) || 1,
        message: 'No changes to save',
      });
    }

    const ts = now();
    const version = nextVersionFor(params.id, existing.version);
    writeVersion(
      params.id, user.sub, version, data.name, existing.description || '',
      existing.status, data.layout, data.theme, existing.thumbnail_url || null,
      null, ts
    );

    const updated = findOwnedProject(params.id, user.sub);
    jsonResponse(res, 200, {
      project: serializeProjectRow(updated),
      saved: true,
      version,
    });
  } catch (err) {
    console.error('[PROJECT] Save version error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/creator/projects/:id/versions — the version history, newest
 * first. List entries carry metadata only; a version's full layout and
 * theme are fetched per-version so the list stays cheap.
 */
export async function handleListProjectVersions(req, res, user, params) {
  try {
    const existing = findOwnedProject(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    const currentVersion = Number(existing.version) || 1;
    const versions = [];
    for (const row of listDesignVersions(params.id)) {
      const version = serializeVersionSummary(row);
      if (!version) continue;
      versions.push({ ...version, is_current: version.version === currentVersion });
    }
    jsonResponse(res, 200, { project_id: params.id, versions });
  } catch (err) {
    console.error('[PROJECT] List versions error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/creator/projects/:id/versions/:version — one full snapshot.
 */
export async function handleGetProjectVersion(req, res, user, params) {
  try {
    const existing = findOwnedProject(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) {
      return errorResponse(res, 400, 'Version must be a positive integer');
    }

    const row = findDesignVersion(params.id, version);
    if (!row) return errorResponse(res, 404, 'Version not found');

    const currentVersion = Number(existing.version) || 1;
    const snapshot = serializeVersionRow(row);
    if (!snapshot) return errorResponse(res, 404, 'Version not found');
    jsonResponse(res, 200, {
      project_id: params.id,
      version: { ...snapshot, is_current: snapshot.version === currentVersion },
    });
  } catch (err) {
    console.error('[PROJECT] Get version error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/creator/projects/:id/versions/:version/restore — restore.
 *
 * Restoring NEVER mutates history: it writes a NEW version whose contents
 * are the selected version's, records the restored-from version on the new
 * row, and makes the new version the current design. The stored snapshot is
 * re-validated before anything is written, so a version can never push an
 * invalid design back into the current row.
 */
export async function handleRestoreProjectVersion(req, res, user, params) {
  try {
    const existing = findOwnedProject(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Project not found');

    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) {
      return errorResponse(res, 400, 'Version must be a positive integer');
    }

    const target = findDesignVersion(params.id, version);
    if (!target) return errorResponse(res, 404, 'Version not found');

    let layout = null;
    let theme = null;
    try {
      layout = JSON.parse(target.layout_config || '{}');
    } catch (e) {
      layout = null;
    }
    if (target.theme_config) {
      try {
        theme = JSON.parse(target.theme_config);
      } catch (e) {
        theme = null;
      }
    }
    const check = validateDesignPayload({ name: target.name, layout, theme }, { partial: false });
    if (check.errors.length > 0) {
      return errorResponse(res, 409, `Version ${version} no longer validates: ${check.errors.join('; ')}`);
    }

    const ts = now();
    const nextVersion = nextVersionFor(params.id, existing.version);
    writeVersion(
      params.id, user.sub, nextVersion, check.data.name, existing.description || '',
      existing.status, check.data.layout, check.data.theme, target.thumbnail_url || null,
      version, ts
    );

    const updated = findOwnedProject(params.id, user.sub);
    jsonResponse(res, 200, {
      project: serializeProjectRow(updated),
      restored_from_version: version,
      version: nextVersion,
    });
  } catch (err) {
    console.error('[PROJECT] Restore version error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}