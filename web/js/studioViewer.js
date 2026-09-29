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

/** Smallest viewer the editor will allow, in screen px. */
export const MIN_VIEWER_WIDTH = 320;
export const MIN_VIEWER_HEIGHT = 240;

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

// ── Direct edge resize (CREATOR-07) ──────────────────────────────────────────
//
// The viewer is its own resize control: the user drags the viewer's own edges
// and corners. These helpers are pure so the hit-testing and clamping can be
// verified without a browser. The viewer's size is editor workspace state — it
// is never written to the profile design.

/**
 * Clamp a proposed viewer box to the editor's limits.
 *
 * The viewer is a rectangle at (x, y) inside the stage, so both the size and the
 * position are clamped: the size to [minimum, stage] and the origin so the box
 * always stays fully inside the stage. Keeping it in-bounds is what guarantees
 * a viewer resize can never introduce a scrollbar.
 */
export function clampViewerRect(
  { x = 0, y = 0, width, height },
  { minWidth = MIN_VIEWER_WIDTH, minHeight = MIN_VIEWER_HEIGHT, boundsWidth = Infinity, boundsHeight = Infinity } = {},
) {
  const w = Math.round(clamp(Number(width) || minWidth, minWidth, Math.max(minWidth, boundsWidth)));
  const h = Math.round(clamp(Number(height) || minHeight, minHeight, Math.max(minHeight, boundsHeight)));
  return {
    width: w,
    height: h,
    // A stage smaller than the minimum pins the box at the origin.
    x: Math.round(clamp(Number(x) || 0, 0, Math.max(0, boundsWidth - w))),
    y: Math.round(clamp(Number(y) || 0, 0, Math.max(0, boundsHeight - h))),
  };
}

/**
 * New viewer box after dragging `mode` (an edgeHitTest result) by the pointer.
 *
 * The edge under the cursor follows it and the opposite edge stays put, so
 * dragging the west edge rightwards grows the viewer leftwards rather than
 * silently moving only the right edge.
 */
export function viewerRectFromDrag({
  mode,
  startRect,
  startClientX,
  startClientY,
  clientX,
  clientY,
  ...limits
}) {
  const start = startRect || {};
  const edge = String(mode || '');
  const dx = (Number(clientX) || 0) - (Number(startClientX) || 0);
  const dy = (Number(clientY) || 0) - (Number(startClientY) || 0);

  const startX = Number(start.x) || 0;
  const startY = Number(start.y) || 0;
  const startWidth = Number(start.width) || 0;
  const startHeight = Number(start.height) || 0;

  let x = startX;
  let y = startY;
  let width = startWidth;
  let height = startHeight;

  if (edge.includes('e')) width = startWidth + dx;
  else if (edge.includes('w')) { x = startX + dx; width = startWidth - dx; }
  if (edge.includes('s')) height = startHeight + dy;
  else if (edge.includes('n')) { y = startY + dy; height = startHeight - dy; }

  return clampViewerRect({ x, y, width, height }, limits);
}
