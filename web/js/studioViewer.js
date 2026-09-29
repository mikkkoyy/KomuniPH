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
/**
 * CREATOR-08: zoom is reintroduced as a compact viewer control, stepping in
 * 10% increments. These are VIEWER values — see the module header: nothing
 * here ever reaches `layout.components[]` or the server.
 */
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;

/** Smallest viewer the editor will allow, in screen px (vertical only). */
export const MIN_VIEWER_HEIGHT = 320;
/**
 * The Profile Viewer's own starting editing height, in screen px.
 *
 * This is a DELIBERATE Creator Studio workspace size, not a derived number: it
 * is never computed from the side panels' height, from the window height, or
 * from a `viewportHeight - chrome` estimate (CREATOR-07B). The design canvas is
 * 960x1200, so 900px shows most of a profile at a comfortable size and makes the
 * viewer — not the Properties/Sections panels — the main editing area.
 */
export const DEFAULT_VIEWER_HEIGHT = 900;
/**
 * Hard ceiling on the viewer height, in screen px. It exists only to stop an
 * unbounded drag producing an absurd box; it is deliberately far larger than
 * the default so the viewer is never made short by a viewport calculation.
 */
export const MAX_VIEWER_HEIGHT = 4000;
/** Smallest a side editor panel may be squeezed to, in screen px. */
export const MIN_PANEL_WIDTH = 220;
/** The center column never shrinks below this, so the viewer stays usable. */
export const MIN_CENTER_WIDTH = 360;

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

/**
 * CREATOR-08: step the zoom by one ZOOM_STEP, clamped to [MIN_ZOOM, MAX_ZOOM].
 * Pure and DOM-free so the bounds can be unit-tested without a browser.
 */
export function stepZoom(zoom, direction) {
  const delta = direction === 'in' ? ZOOM_STEP : direction === 'out' ? -ZOOM_STEP : 0;
  return clampZoom(Number(zoom) + delta);
}

/**
 * CREATOR-08: the viewer default. Zoom returns to 1 and the pan is re-centred
 * for the current viewport by the caller through clampPan(). Returns viewer
 * state only — it can never touch component geometry.
 */
export function defaultViewerState() {
  return { zoom: DEFAULT_ZOOM, pan: { x: 0, y: 0 } };
}

/**
 * CREATOR-08: format a zoom ratio as a whole percentage with no floating-point
 * artifacts — 1 → "100%", 0.75 → "75%", 1.25 → "125%", 2 → "200%".
 */
export function zoomPercent(zoom) {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
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
 * CREATOR-10: the largest zoom that still shows the WHOLE design inside the
 * viewer, in either axis.
 *
 * The design canvas is 960x1200, but the viewer's centre column is whatever the
 * side panels leave over. At 100% the canvas is usually WIDER than that column,
 * so the right-hand edge — where the profile SIDEBAR lives — is clipped off and
 * the creator literally cannot see where the sidebar begins. Fit solves that by
 * scaling the design down to the viewport.
 *
 * Like every other value in this module it is pure VIEWER state: it is clamped
 * into [MIN_ZOOM, MAX_ZOOM] and is never written to a component or the server.
 * A zero/NaN viewport (the stage is not laid out yet) falls back to 1, which
 * is the ordinary 100% view rather than a divide-by-zero.
 */
export function fitZoom({ contentW, contentH, viewportW, viewportH, margin = 0 } = {}) {
  const cw = Number(contentW);
  const ch = Number(contentH);
  const vw = Number(viewportW);
  const vh = Number(viewportH);
  if (!(cw > 0) || !(ch > 0) || !(vw > 0) || !(vh > 0)) return DEFAULT_ZOOM;
  const usableW = Math.max(1, vw - margin);
  const usableH = Math.max(1, vh - margin);
  // Never scale UP past 100%: "fit" is about making a too-large design visible,
  // not about magnifying a small one.
  return clampZoom(Math.min(1, usableW / cw, usableH / ch));
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
 * Clamp the viewer height to a usable editing range.
 *
 * CREATOR-07B: this is deliberately INDEPENDENT of the side panels and of the
 * window. It takes no `viewportHeight`, because a `viewportHeight - chrome`
 * ceiling is what made the viewer unexpectedly short on smaller screens. The
 * only limits are the usability floor and a generous hard ceiling, so the user —
 * not the surrounding layout — decides how tall the editing area is.
 */
export function clampViewerHeight(
  value,
  { min = MIN_VIEWER_HEIGHT, max = MAX_VIEWER_HEIGHT, fallback = DEFAULT_VIEWER_HEIGHT } = {},
) {
  const n = Number(value);
  const resolved = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.round(clamp(resolved, min, Math.max(min, max)));
}
