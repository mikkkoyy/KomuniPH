/**
 * KomuniPH Creator Studio — Profile Viewer geometry (CREATOR-06).
 *
 * The Creator Studio edits two INDEPENDENT coordinate systems:
 *
 *   1. Design coordinates  (layout.components[].x/y/width/height/rotation/zIndex)
 *      The actual saved profile. Authoritative. Never derived from this file.
 *
 *   2. Viewer coordinates  (zoom, panX, panY, viewer width/height)
 *      How the editor *looks at* the design while editing. Purely ephemeral:
 *      nothing here is written to the design, and nothing here is sent to the
 *      server. Changing zoom/pan must never move a component.
 *
 * Keeping the viewer math in its own DOM-free module means the separation is
 * enforced by the module boundary rather than by convention, and the arithmetic
 * can be unit-tested without a browser.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.1;
export const PAN_STEP = 40;
/** Minimum visible overlap, in screen px, between the design and the viewport. */
export const PAN_MARGIN = 80;
/** Breathing room left around the design when computing "fit to screen". */
export const FIT_PADDING = 24;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Round a zoom ratio to 2dp so the readout and the applied scale agree
 * (avoids "110.00000000000001%" in the label).
 */
function roundZoom(value) {
  return Math.round(value * 100) / 100;
}

/** Constrain a zoom ratio to the supported range. */
export function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return roundZoom(clamp(n, MIN_ZOOM, MAX_ZOOM));
}

/** Zoom in (+1) / zoom out (-1) by one step. */
export function stepZoom(current, direction) {
  const base = clampZoom(current);
  const next = base + (direction < 0 ? -ZOOM_STEP : ZOOM_STEP);
  return clampZoom(next);
}

/** Human-readable percentage, e.g. 1.25 -> "125%". */
export function zoomPercent(value) {
  return `${Math.round(clampZoom(value) * 100)}%`;
}

/**
 * Largest zoom that shows the whole design inside the viewer.
 * Uses whichever axis is the tighter constraint, and never exceeds the
 * viewport (never upscales past 100% to fill empty space).
 */
export function fitZoom({ viewportW, viewportH, canvasW, canvasH, padding = FIT_PADDING }) {
  const usableW = Number(viewportW) - padding * 2;
  const usableH = Number(viewportH) - padding * 2;
  if (!(usableW > 0) || !(usableH > 0) || !(canvasW > 0) || !(canvasH > 0)) return 1;
  const scale = Math.min(usableW / canvasW, usableH / canvasH, 1);
  return clampZoom(scale);
}

/**
 * Keep the design reachable: when it is larger than the viewer the user may pan
 * until only PAN_MARGIN of it remains on screen; when it fits, it is centred.
 * Pan values are in SCREEN pixels (the scale is applied before the translate).
 */
export function clampPan({ panX, panY, viewportW, viewportH, contentW, contentH, margin = PAN_MARGIN }) {
  const scaledW = contentW * 1;
  const scaledH = contentH * 1;
  const clampAxis = (pan, viewport, scaled) => {
    if (scaled <= viewport) return Math.round((viewport - scaled) / 2);
    const limit = scaled - viewport + margin;
    return Math.round(clamp(pan, -limit, margin));
  };
  return {
    x: clampAxis(Number(panX) || 0, viewportW, scaledW),
    y: clampAxis(Number(panY) || 0, viewportH, scaledH),
  };
}

/** Nudge the viewer by PAN_STEP in the given direction. */
export function stepPan(pan, direction) {
  const delta = { left: [PAN_STEP, 0], right: [-PAN_STEP, 0], up: [0, PAN_STEP], down: [0, -PAN_STEP] }[direction];
  if (!delta) return { x: pan.x, y: pan.y };
  return { x: pan.x + delta[0], y: pan.y + delta[1] };
}

/**
 * CSS transform for the zoom layer. `transform-origin: 0 0` means the
 * translate below is expressed in unscaled screen pixels, so pan and zoom do
 * not interfere with one another.
 */
export function viewerTransform({ zoom, panX = 0, panY = 0 }) {
  return `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${clampZoom(zoom)})`;
}

/**
 * Convert a pointer position to design coordinates.
 * getBoundingClientRect() already reflects the applied translate+scale, so the
 * pan is cancelled for free and only the zoom has to be divided out.
 */
export function designPoint({ clientX, clientY, rect, zoom }) {
  return {
    x: (clientX - rect.left) / clampZoom(zoom),
    y: (clientY - rect.top) / clampZoom(zoom),
  };
}
