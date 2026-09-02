import { describe, expect, it } from "vitest";

import { DEFAULT_SIZE, MARGIN, MIN_SIZE, anchor, fitSize, nearest, resizeDirection } from "./pipGeometry";

const BOUNDS = { width: 1200, height: 800 };
const STILL = { x: 0, y: 0 };

describe("anchor", () => {
  it("puts each corner inside the field", () => {
    expect(anchor("tl", BOUNDS)).toEqual({ x: MARGIN, y: MARGIN });
    expect(anchor("tr", BOUNDS)).toEqual({ x: BOUNDS.width - DEFAULT_SIZE.width - MARGIN, y: MARGIN });
    expect(anchor("bl", BOUNDS)).toEqual({ x: MARGIN, y: BOUNDS.height - DEFAULT_SIZE.height - MARGIN });
    expect(anchor("br", BOUNDS)).toEqual({
      x: BOUNDS.width - DEFAULT_SIZE.width - MARGIN,
      y: BOUNDS.height - DEFAULT_SIZE.height - MARGIN,
    });
  });

  it("stays on screen when the panel is smaller than the card", () => {
    /* Dragging the editor column narrow used to push the card off its own edge,
       leaving a strip of it visible and no way to grab the header back. */
    const cramped = anchor("br", { width: 200, height: 200 });
    expect(cramped.x).toBeGreaterThanOrEqual(MARGIN);
    expect(cramped.y).toBeGreaterThanOrEqual(MARGIN);
  });
});

describe("fitSize", () => {
  it("leaves a size that fits alone", () => {
    expect(fitSize({ width: 500, height: 500 }, BOUNDS)).toEqual({ width: 500, height: 500 });
  });

  it("never goes below the readable minimum", () => {
    const tiny = fitSize({ width: 40, height: 40 }, BOUNDS);
    expect(tiny).toEqual(MIN_SIZE);
  });

  it("shrinks to the panel, and stops at the minimum when the panel is smaller still", () => {
    expect(fitSize({ width: 900, height: 900 }, { width: 600, height: 500 })).toEqual({
      width: 600 - MARGIN * 2,
      height: 500 - MARGIN * 2,
    });
    expect(fitSize({ width: 900, height: 900 }, { width: 120, height: 120 })).toEqual(MIN_SIZE);
  });
});

describe("resizeDirection", () => {
  it("grows away from the corner the card is pinned to", () => {
    /* Pinned bottom-right, the free corner is top-left: dragging up and left
       has to make it bigger, not smaller. */
    expect(resizeDirection("br")).toEqual({ x: -1, y: -1 });
    expect(resizeDirection("tl")).toEqual({ x: 1, y: 1 });
    expect(resizeDirection("tr")).toEqual({ x: -1, y: 1 });
    expect(resizeDirection("bl")).toEqual({ x: 1, y: -1 });
  });
});

describe("nearest", () => {
  /* Positions are the card's top-left, as the component holds them. */
  const centred = (corner: "tl" | "tr" | "bl" | "br") => anchor(corner, BOUNDS);

  it("returns the corner it was released in", () => {
    expect(nearest(centred("tl"), STILL, BOUNDS)).toBe("tl");
    expect(nearest(centred("tr"), STILL, BOUNDS)).toBe("tr");
    expect(nearest(centred("bl"), STILL, BOUNDS)).toBe("bl");
    expect(nearest(centred("br"), STILL, BOUNDS)).toBe("br");
  });

  it("follows a throw past the quadrant it was let go in", () => {
    /* Released on the left but flicked hard right: the corner it was aimed at
       wins over the one it happened to be in, which is what makes throwing it
       feel like it obeys. */
    const leftish = centred("tl");
    expect(nearest(leftish, STILL, BOUNDS)).toBe("tl");
    expect(nearest(leftish, { x: 6000, y: 0 }, BOUNDS)).toBe("tr");
  });

  it("can still be moved upward when the card is nearly as tall as the panel", () => {
    /* The bug this replaced: measuring against anchors put the top and bottom
       anchors a few pixels apart for a card this size — and at the same point
       once it was taller than the panel — so dragging up sprang back down every
       time. The quadrant of the centre does not care how big the card is. */
    const short = { width: 900, height: 520 };
    const tall = { width: 360, height: 400 };
    /* Only 96px of vertical travel, and both ends of it still resolve to the
       corner they are at. Measuring from the panel's own midpoint would call
       both of these "top", since a card this tall has its centre near the
       middle wherever it sits. */
    expect(nearest({ x: MARGIN, y: MARGIN }, STILL, short, tall)).toBe("tl");
    expect(nearest({ x: MARGIN, y: short.height - tall.height - MARGIN }, STILL, short, tall)).toBe("bl");

    /* Taller than the panel: the two vertical anchors collapse onto the same
       point, so which one is reported does not matter — it must simply pick a
       left corner and not fail. */
    const overflowing = { width: 360, height: 700 };
    expect(["tl", "bl"]).toContain(nearest({ x: MARGIN, y: -200 }, STILL, short, overflowing));
  });

  it("measures against the size the card actually is", () => {
    /* A card resized wide has its centre much further right for the same
       top-left, so the same release point belongs to a different corner. */
    expect(nearest({ x: 280, y: 60 }, STILL, BOUNDS, { width: 900, height: 300 })).toBe("tr");
    expect(nearest({ x: 280, y: 60 }, STILL, BOUNDS, DEFAULT_SIZE)).toBe("tl");
  });

  it("does not change corner for a slow drift", () => {
    expect(nearest(centred("br"), { x: -30, y: -30 }, BOUNDS)).toBe("br");
  });
});
