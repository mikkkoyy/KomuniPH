/**
 * KomuniPH Creator Studio Project Manager (CREATOR-14).
 *
 * The project manager is the entry point to Creator Studio. It lists all
 * of the user's projects (active + archived) and provides actions to create,
 * open, rename, duplicate, archive, restore, and delete projects.
 *
 * Route: #/creator-studio/projects
 */

import { projectApi } from './api.js';
import { navigate } from './app.js';

let root = null;
let projects = [];
let busy = false;

/**
 * Render the Creator Projects page.
 */
export function renderCreatorProjectsPage() {
  return `<main id="creator-projects" class="creator-projects">
    <header class="projects-heading">
      <a href="#/profile" class="projects-back">← Return to profile</a>
      <p class="editor-eyebrow">CREATOR STUDIO</p>
      <h1>Projects</h1>
      <p>Manage your Creator Studio projects. Each project is a complete profile design.</p>
    </header>
    <p id="projects-status" role="status" aria-live="polite">Loading projects…</p>
    <div class="projects-toolbar">
      <button id="projects-new" class="btn btn-primary" type="button">New Project</button>
    </div>
    <section id="projects-list" class="projects-grid" role="list" aria-label="Your projects"></section>
    <section id="projects-archived" class="projects-archived-section" hidden>
      <h2>Archived Projects</h2>
      <div class="projects-grid" id="projects-archived-grid" role="list" aria-label="Archived projects"></div>
    </section>
  </main>`;
}

/**
 * Initialize the Creator Projects page.
 */
export function initCreatorProjectsPage() {
  root = document.getElementById('creator-projects');
  if (!root) return;

  bindToolbar();
  loadProjects();
}

function bindToolbar() {
  const newBtn = root.querySelector('#projects-new');
  if (newBtn) {
    newBtn.addEventListener('click', () => openCreateModal());
  }
}

async function loadProjects() {
  setStatus('Loading projects…');
  try {
    const res = await projectApi.listProjects();
    if (res && Array.isArray(res.projects)) {
      projects = res.projects;
      renderProjects();
      setStatus(`${projects.filter(p => p.status !== 'archived').length} active project(s), ${projects.filter(p => p.status === 'archived').length} archived`);
    } else {
      projects = [];
      renderProjects();
      setStatus('No projects yet. Create your first project!');
    }
  } catch (err) {
    console.error('[PROJECTS] Load error:', err);
    projects = [];
    renderProjects();
    setStatus('Failed to load projects: ' + (err.message || 'Unknown error'));
  }
}

function renderProjects() {
  const activeGrid = root?.querySelector('#projects-list');
  const archivedSection = root?.querySelector('#projects-archived');
  const archivedGrid = root?.querySelector('#projects-archived-grid');

  if (!activeGrid || !archivedSection || !archivedGrid) return;

  const active = projects.filter(p => p.status !== 'archived');
  const archived = projects.filter(p => p.status === 'archived');

  activeGrid.innerHTML = active.map(projectCardHtml).join('') || '<p class="projects-empty">No active projects. Click "New Project" to get started.</p>';
  archivedGrid.innerHTML = archived.map(archivedProjectCardHtml).join('');
  archivedSection.hidden = archived.length === 0;

  bindProjectActions();
}

function projectCardHtml(project) {
  const updated = formatRelativeTime(project.updated_at);
  const statusLabel = project.status === 'published' ? 'Published' : 'Draft';
  const statusClass = project.status === 'published' ? 'status-published' : 'status-draft';
  const thumb = project.thumbnail_url || '';

  return `<article class="project-card" data-project-id="${project.id}" role="listitem">
    <div class="project-thumb" style="${thumb ? `background-image:url(${thumb})` : ''}">
      ${!thumb ? '<span class="project-thumb-placeholder">📄</span>' : ''}
      <span class="project-status-chip ${statusClass}">${statusLabel}</span>
    </div>
    <div class="project-info">
      <h3 class="project-name">${escapeHtml(project.name)}</h3>
      ${project.description ? `<p class="project-description">${escapeHtml(project.description)}</p>` : ''}
      <div class="project-meta">
        <span class="project-version">v${project.version}</span>
        <span class="project-updated">${updated}</span>
      </div>
    </div>
    <div class="project-actions">
      <button type="button" class="btn btn-primary project-open" data-action="open" title="Open in Creator Studio">Open</button>
      <button type="button" class="btn btn-secondary project-rename" data-action="rename" title="Rename">Rename</button>
      <button type="button" class="btn btn-secondary project-duplicate" data-action="duplicate" title="Duplicate">Duplicate</button>
      <button type="button" class="btn btn-secondary project-archive" data-action="archive" title="Archive">Archive</button>
    </div>
  </article>`;
}

function archivedProjectCardHtml(project) {
  const updated = formatRelativeTime(project.updated_at);
  const archivedAt = project.archived_at ? formatRelativeTime(project.archived_at) : 'Unknown';
  const thumb = project.thumbnail_url || '';

  return `<article class="project-card archived" data-project-id="${project.id}" role="listitem">
    <div class="project-thumb" style="${thumb ? `background-image:url(${thumb})` : ''}">
      ${!thumb ? '<span class="project-thumb-placeholder">📦</span>' : ''}
      <span class="project-status-chip status-archived">Archived</span>
    </div>
    <div class="project-info">
      <h3 class="project-name">${escapeHtml(project.name)}</h3>
      ${project.description ? `<p class="project-description">${escapeHtml(project.description)}</p>` : ''}
      <div class="project-meta">
        <span class="project-version">v${project.version}</span>
        <span class="project-updated">Updated ${updated}</span>
        <span class="project-archived">Archived ${archivedAt}</span>
      </div>
    </div>
    <div class="project-actions">
      <button type="button" class="btn btn-primary project-restore" data-action="restore" title="Restore to active">Restore</button>
      <button type="button" class="btn btn-danger project-delete" data-action="delete" title="Permanently delete">Delete</button>
    </div>
  </article>`;
}

function bindProjectActions() {
  root?.querySelectorAll('.project-card').forEach(card => {
    const id = card.dataset.projectId;
    if (!id) return;

    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        switch (action) {
          case 'open': openProject(id); break;
          case 'rename': openRenameModal(id); break;
          case 'duplicate': duplicateProject(id); break;
          case 'archive': archiveProject(id); break;
          case 'restore': restoreProject(id); break;
          case 'delete': deleteProject(id); break;
        }
      });
    });

    // Click on card (not buttons) also opens
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openProject(id);
    });
  });
}

async function openProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  // Navigate to Creator Studio with the project ID
  navigate(`/creator-studio?project=${encodeURIComponent(id)}`);
}

async function openCreateModal() {
  const name = prompt('Project name:', 'Untitled Project');
  if (!name || !name.trim()) return;

  const description = prompt('Description (optional):', '') || '';

  await createProject(name.trim(), description.trim());
}

async function createProject(name, description) {
  if (busy) return;
  busy = true;
  setStatus('Creating project…');

  try {
    const res = await projectApi.createProject({ name, description });
    if (res && res.project) {
      setStatus('Project created. Opening…');
      navigate(`/creator-studio?project=${encodeURIComponent(res.project.id)}`);
    }
  } catch (err) {
    console.error('[PROJECTS] Create error:', err);
    alert('Failed to create project: ' + (err.message || 'Unknown error'));
    setStatus('Ready');
  } finally {
    busy = false;
  }
}

async function openRenameModal(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  const newName = prompt('Rename project:', project.name);
  if (!newName || !newName.trim() || newName.trim() === project.name) return;

  await renameProject(id, newName.trim());
}

async function renameProject(id, name) {
  if (busy) return;
  busy = true;
  setStatus('Renaming…');

  try {
    const res = await projectApi.updateProject(id, { name });
    if (res && res.project) {
      loadProjects();
      setStatus('Project renamed');
    }
  } catch (err) {
    console.error('[PROJECTS] Rename error:', err);
    alert('Failed to rename project: ' + (err.message || 'Unknown error'));
    setStatus('Ready');
  } finally {
    busy = false;
  }
}

async function duplicateProject(id) {
  if (busy) return;
  busy = true;
  setStatus('Duplicating project…');

  try {
    const res = await projectApi.duplicateProject(id);
    if (res && res.project) {
      loadProjects();
      setStatus('Project duplicated');
    }
  } catch (err) {
    console.error('[PROJECTS] Duplicate error:', err);
    alert('Failed to duplicate project: ' + (err.message || 'Unknown error'));
    setStatus('Ready');
  } finally {
    busy = false;
  }
}

async function archiveProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  if (!confirm(`Archive "${project.name}"? It will be moved to the archived section.`)) return;

  if (busy) return;
  busy = true;
  setStatus('Archiving…');

  try {
    const res = await projectApi.archiveProject(id);
    if (res && res.project) {
      loadProjects();
      setStatus('Project archived');
    }
  } catch (err) {
    console.error('[PROJECTS] Archive error:', err);
    alert('Failed to archive project: ' + (err.message || 'Unknown error'));
    setStatus('Ready');
  } finally {
    busy = false;
  }
}

async function restoreProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  if (!confirm(`Restore "${project.name}" to active projects?`)) return;

  if (busy) return;
  busy = true;
  setStatus('Restoring…');

  try {
    const res = await projectApi.restoreProject(id);
    if (res && res.project) {
      loadProjects();
      setStatus('Project restored');
    }
  } catch (err) {
    console.error('[PROJECTS] Restore error:', err);
    alert('Failed to restore project: ' + (err.message || 'Unknown error'));
    setStatus('Ready');
  } finally {
    busy = false;
  }
}

async function deleteProject(id) {
  const project = projects.find(p => p.id === id);
  if (!project) return;

  if (!confirm(`Permanently delete "${project.name}"? This cannot be undone.`)) return;
  if (!confirm('Are you absolutely sure? The project and all its design data will be deleted.')) return;

  if (busy) return;
  busy = true;
  setStatus('Deleting…');

  try {
    await projectApi.deleteProject(id);
    loadProjects();
    setStatus('Project deleted');
  } catch (err) {
    console.error('[PROJECTS] Delete error:', err);
    alert('Failed to delete project: ' + (err.message || 'Unknown error'));
    setStatus('Ready');
  } finally {
    busy = false;
  }
}

function setStatus(message) {
  const status = root?.querySelector('#projects-status');
  if (status) status.textContent = message;
}

/**
 * Check if it's safe to leave the projects page (no pending operations).
 */
export function canLeaveCreatorProjects() {
  return !busy;
}

/**
 * Cleanup when leaving the page.
 */
export function destroyCreatorProjectsPage() {
  root = null;
  projects = [];
  busy = false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString.replace(' ', 'T'));
  if (isNaN(date.getTime())) return 'Unknown';
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}