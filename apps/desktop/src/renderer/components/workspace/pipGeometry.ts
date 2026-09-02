/**
 * Where the floating concept card sits, how big it may be, and where a throw
 * sends it.
 *
 * Separated from the component because it is pure arithmetic and the component
 * reaches Monaco through `ConceptEntry` — the geometry is the part worth
 * testing, and it should not need a DOM to do it.
 */
export type Corner = "tl" | "tr" | "bl" | "br";

export type Size = { width: number; height: number };
export type Bounds = { width: number; height: number };

export const MARGIN = 12;
export const DEFAULT_SIZE: Size = { width: 360, height: 420 };
/** Below this the entry stops being readable — a measure this narrow breaks
 *  prose into a column of single words. */
export const MIN_SIZE: Size = { width: 280, height: 220 };

/** The size actually usable, given the space around it. A card larger than the
 *  panel it floats in has no corner it can sit in without hanging off one. */
export function fitSize(size: Size, bounds: Bounds): Size {
  const room = { width: bounds.width - MARGIN * 2, height: bounds.height - MARGIN * 2 };
  return {
    width: Math.max(MIN_SIZE.width, Math.min(size.width, Math.max(MIN_SIZE.width, room.width))),
    height: Math.max(MIN_SIZE.height, Math.min(size.height, Math.max(MIN_SIZE.height, room.height))),
  };
}

/** Where a corner sits, given the card's size and the space available. Clamped
 *  so a panel narrower than the card still yields a position inside it rather
 *  than off the edge. */
export function anchor(corner: Corner, bounds: Bounds, size: Size = DEFAULT_SIZE): { x: number; y: number } {
  const right = Math.max(MARGIN, bounds.width - size.width - MARGIN);
  const bottom = Math.max(MARGIN, bounds.height - size.height - MARGIN);
  return {
    x: corner === "tl" || corner === "bl" ? MARGIN : right,
    y: corner === "tl" || corner === "tr" ? MARGIN : bottom,
  };
}

/**
 * Which way a resize grows.
 *
 * The card is pinned by its corner, so the handle is on the two edges facing
 * into the panel and dragging *away* from the anchor is what makes it bigger.
 * Getting this wrong makes the card shrink when pulled, which reads as broken
 * rather than as inverted.
 */
export function resizeDirection(corner: Corner): { x: 1 | -1; y: 1 | -1 } {
  return {
    x: corner === "tl" || corner === "bl" ? 1 : -1,
    y: corner === "tl" || corner === "tr" ? 1 : -1,
  };
}

/**
 * The corner a throw was aimed at.
 *
 * Decided by which quadrant the card's *centre* ends up in, not by which anchor
 * point it was released nearest. Measuring against the anchors sounds equivalent
 * and is not: the anchors are only `bounds - size` apart, so a large card in a
 * small panel has its top and bottom anchors a few dozen pixels from each other
 * — and once the card is taller than the panel they are the same point. Dragging
 * it upward then could not change the answer, and it sprang back down every
 * time. The quadrant of the centre is independent of how big the card is.
 *
 * Velocity is projected forward before measuring, so a flick toward a corner
 * lands there even when the finger let go short of it — which is what makes
 * throwing it feel like it obeys rather than merely snapping.
 */
export function nearest(
  point: { x: number; y: number },
  velocity: { x: number; y: number },
  bounds: Bounds,
  size: Size = DEFAULT_SIZE,
): Corner {
  const aimed = { x: point.x + velocity.x * 0.14, y: point.y + velocity.y * 0.14 };
  const far = anchor("br", bounds, size);
  /* Halfway along the travel each axis actually has, rather than the middle of
     the panel: the card's own size eats that travel, so a wide card's midpoint
     sits well left of the panel's. */
  const left = aimed.x < (MARGIN + far.x) / 2;
  const top = aimed.y < (MARGIN + far.y) / 2;
  return left ? (top ? "tl" : "bl") : top ? "tr" : "br";
}
