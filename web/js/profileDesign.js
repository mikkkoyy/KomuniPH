/**
 * KomuniPH Profile Design renderer (CREATOR-01A).
 *
 * Controlled layout application for the shared profile page. A published design
 * repositions/resizes/visibility-toggles the platform's OWN, already-escaped
 * sections — the renderer never injects HTML or executes script from a design.
 * With no design (or an unusable one) the page renders exactly as before.
 *
 * This module is deliberately free of imports from profile.js so the profile
 * page can consume it without a circular dependency; any design-level theme
 * overrides are folded into the existing theme pipeline by the caller.
 */

const COMPONENT_SELECTORS = {
  profile_photo: '.profile-header-photo-column',
  name: '#profile-name',
  alias: '#profile-nickname',
  bio: '#profile-bio-box',
  personal_info: '#personal-info-module',
  gallery: '#photo-gallery-module',
  testimonials: '#testimonials-module',
  communities: '#community-module',
};

/**
 * Defensive, client-side shape check. The server already validates stored
 * designs, but the renderer must be safe against any malformed data it is given.
 */
function resolveDesign(profile) {
  const design = profile && profile.design;
  if (!design || typeof design !== 'object') return null;
  const layout = design.layout;
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.components)) return null;
  return layout;
}

/** Clear any previous design styles so the default rendering is restored. */
function restoreDefault() {
  const frame = document.getElementById('profile-frame');
  if (frame) {
    frame.classList.remove('has-profile-design');
    frame.style.removeProperty('--design-canvas-minheight');
  }
  for (const selector of Object.values(COMPONENT_SELECTORS)) {
    document.querySelectorAll(selector).forEach(el => {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      el.style.zIndex = '';
      el.style.display = '';
    });
  }
}

function px(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${value}px`;
}

/**
 * Apply a profile's published design to the currently mounted profile frame.
 * No-op (default rendering) when there is no usable design. Never throws.
 */
export function applyProfileDesign(profile) {
  try {
    const frame = document.getElementById('profile-frame');
    const content = document.getElementById('profile-content');
    if (!frame || !content) {
      // Gallery/album pages mount a different layout — leave them untouched.
      return;
    }

    const layout = resolveDesign(profile);
    if (!layout) {
      restoreDefault();
      return;
    }

    const canvas = layout.canvas || {};
    if (canvas.minHeight) frame.style.setProperty('--design-canvas-minheight', px(canvas.minHeight));
    frame.classList.add('has-profile-design');

    layout.components.forEach(component => {
      const selector = COMPONENT_SELECTORS[component.type];
      if (!selector) return;
      const el = content.querySelector(selector);
      if (!el) return;

      if (component.visible === false) {
        el.style.display = 'none';
        return;
      }
      el.style.position = 'absolute';
      el.style.left = px(component.x);
      el.style.top = px(component.y);
      el.style.width = px(component.width);
      el.style.height = px(component.height);
      el.style.zIndex = String(component.zIndex ?? 0);
    });
  } catch (err) {
    // Cosmetic only — never break the page over a design.
    console.warn('[DESIGN] Could not apply profile design:', err.message || err);
  }
}