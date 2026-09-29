/**
 * KomuniPH Creator Studio — Profile Viewer geometry (CREATOR-06, CREATOR-07).
 *
 * The Creator Studio edits two INDEPENDENT coordinate systems:
 *
 *   1. Design coordinates  (layout.components[].x/y/width/height/rotation/zIndex)
 *      The actual saved profile. Authoritative. Never derived from this file.
 *
 *   2. Viewer coordinates  (zoom, panX, panY, viewer width/height)
 *      How the editor *looks at* the design while editing. Purely ephemeral:
 *      nothing here is written to the design, and nothing here is sent to the
 *      server. Changing zoom/pan/resize must never move a component.
 *
 * Keeping the viewer math in its own DOM-free module means the separation is
 * enforced by the module boundary rather than by convention, and the arithmetic
 * can be unit-tested without a browser.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const PAN_STEP = 40;
/** Minimum visible overlap, in screen px, between the design and the viewport. */
export const PAN_MARGIN = 80;

/** Smallest viewer the editor will allow, in screen px (vertical only). */
export const MIN_VIEWER_HEIGHT = 240;
/** Smallest a side editor panel may be squeezed to, in screen px. */
export const MIN_PANEL_WIDTH = 220;
/** The center column never shrinks below this, so the viewer stays usable. */
export const MIN_CENTER_WIDTH = 360;
/**
 * Approximate vertical space outside the stage (toolbar, status bar, Layers
 * panel) that the viewer height has to leave alone, so growing the viewer
 * cannot push the page into a vertical scrollbar.
 */
export const VIEWER_HEIGHT_CHROME = 200;

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

// CREATOR-07: the viewer toolbar is gone, so there is no zoom percentage to
// format. Zoom itself stays a viewer concept (the document may be larger than
// the viewer) — only the controls that used to mutate it were removed.
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

// ── Workspace resize (CREATOR-07A) ───────────────────────────────────────────
//
// The editor's horizontal space belongs to the PANELS, not to the viewer: the
// viewer always fills the center column, and the two column boundaries are
// dragged to change panel widths. The viewer is only adjustable vertically, via
// its own bottom boundary. All of it is editor workspace state and is never
// written to the profile design.

/** Clamp one side panel's width. */
export function clampPanelWidth(value, { min = MIN_PANEL_WIDTH, max = Infinity } = {}) {
  return Math.round(clamp(Number(value) || min, min, Math.max(min, max)));
}

/**
 * New side-panel widths after dragging a column boundary horizontally.
 *
 * `edge` is the boundary being dragged: 'left' is the line between the left
 * panel and the center, 'right' the one between the center and the Properties
 * panel. Each drag moves exactly one panel, and the center column absorbs the
 * difference, so the viewer never needs a horizontal resize of its own.
 *
 * The centre column is held at or above MIN_CENTER_WIDTH so dragging a panel
 * wide can never squeeze the viewer out of existence.
 */
export function columnWidthsFromDrag({
  startLeft,
  startRight,
  edge,
  startClientX,
  clientX,
  totalWidth,
  minPanel = MIN_PANEL_WIDTH,
  minCenter = MIN_CENTER_WIDTH,
}) {
  const left0 = Number(startLeft) || 0;
  const right0 = Number(startRight) || 0;
  const total = Number(totalWidth) || 0;
  const dx = (Number(clientX) || 0) - (Number(startClientX) || 0);

  let left = left0;
  let right = right0;
  if (edge === 'left') left = left0 + dx;
  else if (edge === 'right') right = right0 - dx;

  // Each panel keeps its own minimum, then the pair is pulled back if together
  // they would starve the center column.
  let nextLeft = clampPanelWidth(left, { min: minPanel, max: Math.max(minPanel, total - minCenter - right0) });
  let nextRight = clampPanelWidth(right, { min: minPanel, max: Math.max(minPanel, total - minCenter - nextLeft) });
  // The second clamp can invalidate the first on very narrow layouts; settle it.
  if (nextLeft + nextRight > total - minCenter) {
    const overflow = nextLeft + nextRight - (total - minCenter);
    nextLeft = clampPanelWidth(nextLeft - overflow, { min: minPanel, max: Infinity });
  }
  return { left: nextLeft, right: nextRight };
}

/**
 * Clamp the viewer height. The maximum is derived from the window height so a
 * tall viewer cannot push the studio into a vertical scrollbar.
 */
export function clampViewerHeight(value, { min = MIN_VIEWER_HEIGHT, viewportHeight, chrome = VIEWER_HEIGHT_CHROME } = {}) {
  const max = Number.isFinite(viewportHeight) && viewportHeight > 0
    ? Math.max(min, viewportHeight - chrome)
    : Infinity;
  return Math.round(clamp(Number(value) || min, min, max));
}
