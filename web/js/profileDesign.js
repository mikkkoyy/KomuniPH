/**
 * KomuniPH Profile Design renderer (CREATOR-01A / CREATOR-01B).
 *
 * Controlled layout application for the shared profile page. A published design
 * repositions/resizes/visibility-toggles the platform's OWN, already-escaped
 * sections — the renderer never injects HTML or executes script from a design.
 * With no design (or an unusable one) the page renders exactly as before.
 *
 * CREATOR-01B adds the four user-content component types (text / image / card /
 * sticker). Those are built with element APIs (textContent / src assignment)
 * only — never innerHTML — so a stored config can express text and an HTTP(S)
 * image URL but can never execute, inline style-inject, or emit markup.
 *
 * This module is deliberately free of imports from profile.js so the profile
 * page can consume it without a circular dependency; any design-level theme
 * overrides are folded into the existing theme pipeline by the caller.
 */

export const CONTENT_COMPONENT_TYPES = new Set(['text', 'image', 'card', 'sticker']);

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

/** Elements created for user-content components, keyed by component id. */
const contentElements = new Map();

function px(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${value}px`;
}

function numOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Inline SVG icons for content-type placeholders. Kept in JS to avoid static files. */
const TYPE_ICONS = {
  text: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16M4 8.5h9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M15.5 12.5v6M13 12.5h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M5 17l4.5-4.5 3.5 3 3-3 3 3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  card: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h12M6 13.5h7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  sticker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c5.2 0 9.5 4.3 9.5 9.5s-8.6 9.5-9.5 9.5c-1.5 0-2.3-1.1-3.8-1.1-1.6 0-2.1-1-1.1-2.4.5-.6 1.1-1.4.8-2-.6-1.2-2-1-2-2.6 0-1.4 1-2 1.2-3C8.2 6.5 8.4 10.5 12 10.5s3.3-6.2 0-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
};

function applyTransform(el, component) {
  const rotation = numOr(component.rotation, 0);
  el.style.transform = rotation ? `rotate(${rotation}deg)` : '';
}

/**
 * Apply the shared position/size/rotation fields for a component node.
 * With applyVisibility false (used by the editor canvas), hidden components are
 * left visible so the user can still select them in the layers panel.
 */
export function applyGeometryToElement(el, component, { applyVisibility = true } = {}) {
  if (applyVisibility && component.visible === false) {
    el.style.display = 'none';
  } else {
    el.style.display = '';
    el.style.position = 'absolute';
    el.style.left = px(component.x);
    el.style.top = px(component.y);
    el.style.width = px(component.width);
    el.style.height = px(component.height);
    el.style.zIndex = String(numOr(component.zIndex, 0));
  }
  applyTransform(el, component);
}

/** Apply the optional style fields (background / color / border / radius / opacity / shadow). */
export function applyCommonStyleToElement(el, style) {
  if (!style) return;
  if (style.background) el.style.backgroundColor = style.background;
  if (style.textColor) el.style.color = style.textColor;
  if (style.borderColor) el.style.borderColor = style.borderColor;
  if (style.borderWidth !== undefined && style.borderWidth !== null) {
    el.style.borderStyle = style.borderWidth > 0 ? 'solid' : 'none';
    el.style.borderWidth = px(style.borderWidth);
  }
  if (style.borderRadius !== undefined && style.borderRadius !== null) el.style.borderRadius = px(style.borderRadius);
  if (style.opacity !== undefined && style.opacity !== null) el.style.opacity = String(style.opacity);
  if (style.shadowEnabled) {
    const offsetX = numOr(style.shadowOffset, 0);
    const blur = numOr(style.shadowBlur, 12);
    const color = style.shadowColor || 'rgba(0, 0, 0, 0.25)';
    el.style.boxShadow = `${px(offsetX)} ${px(offsetX)} ${px(blur)} ${color}`;
  }
}

/**
 * Apply the position/size/visibility fields shared by every component type.
 * Never called for elements already created by the caller.
 */
function applyGeometry(el, component) {
  applyGeometryToElement(el, component);
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Build (or refresh) the DOM for a user-content component, safely. */
function renderContentComponent(component, content) {
  const { type, config = {} } = component;
  const key = component.id;
  let el = contentElements.get(key);

  if (!el) {
    el = document.createElement('div');
    el.className = 'design-component';
    el.dataset.componentId = key;
    el.dataset.componentType = type;
    content.appendChild(el);
    contentElements.set(key, el);
  }

  el.className = `design-component design-${type}`;
  clearChildren(el);
  applyGeometry(el, component);
  applyCommonStyleToElement(el, component.style);

  if (type === 'image' || type === 'sticker') {
    const wrapper = document.createElement('div');
    wrapper.className = 'design-image-inner';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = config.alt || '';
    img.className = `design-image-fit-${IMAGE_FIT_CLASSES(config.fit)}`;
    if (config.backgroundColor) wrapper.style.backgroundColor = config.backgroundColor;
    img.addEventListener('error', () => {
      wrapper.classList.add('design-image-broken');
    }, { once: true });
    img.src = config.imageUrl || '';
    wrapper.appendChild(img);
    if (!config.imageUrl) wrapper.classList.add('design-image-broken');
    el.appendChild(wrapper);
    return;
  }

  if (type === 'text') {
    const span = document.createElement('div');
    span.className = 'design-text-content';
    span.textContent = config.text || '';
    if (config.fontSize) span.style.fontSize = px(config.fontSize);
    if (config.fontWeight) span.style.fontWeight = String(config.fontWeight);
    if (config.textAlign) span.style.textAlign = config.textAlign;
    if (config.lineHeight) span.style.lineHeight = String(config.lineHeight);
    if (config.textColor) span.style.color = config.textColor;
    el.appendChild(span);
    return;
  }

  if (type === 'card') {
    const heading = document.createElement('div');
    heading.className = 'design-card-heading';
    heading.textContent = config.heading || '';
    if (config.headingColor) heading.style.color = config.headingColor;
    el.appendChild(heading);
    if (config.body) {
      const body = document.createElement('div');
      body.className = 'design-card-body';
      body.textContent = config.body;
      if (config.textColor) body.style.color = config.textColor;
      el.appendChild(body);
    }
    if (config.textAlign) el.style.textAlign = config.textAlign;
    return;
  }
}

function IMAGE_FIT_CLASSES(fit) {
  return ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover';
}

function imgHasBrokenState(el) {
  const inner = el.querySelector('.design-image-inner');
  return inner ? inner.classList.contains('design-image-broken') : false;
}

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
      el.style.transform = '';
    });
  }
  for (const el of contentElements.values()) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  contentElements.clear();
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

    // Reconcile persistent content components with the design's declared ids so
    // a removed component is always cleaned up even if the render function
    // short-circuits below (e.g. selection filter).
    const contentIds = new Set(
      layout.components.filter(c => CONTENT_COMPONENT_TYPES.has(c.type)).map(c => c.id)
    );
    for (const [key, el] of contentElements) {
      if (!contentIds.has(key) && el.parentNode) el.parentNode.removeChild(el);
    }
    for (const [key] of contentElements) {
      if (!contentIds.has(key)) contentElements.delete(key);
    }

    layout.components.forEach(component => {
      if (CONTENT_COMPONENT_TYPES.has(component.type)) {
        renderContentComponent(component, content);
        return;
      }

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
      el.style.zIndex = String(numOr(component.zIndex, 0));
      applyTransform(el, component);
      applyCommonStyleToElement(el, component.style);
    });
  } catch (err) {
    // Cosmetic only — never break the page over a design.
    console.warn('[DESIGN] Could not apply profile design:', err.message || err);
  }
}