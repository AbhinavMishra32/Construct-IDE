import type { Transition, Variants } from "framer-motion";

export type OverlaySide = "top" | "right" | "bottom" | "left";

/**
 * Every surface that pops open in the app — menus, tooltips, hover cards,
 * modals — moves on the springs below, so opening a menu and opening a dialog
 * feel like the same gesture at two different sizes.
 *
 * Opens spring, closes don't. A spring's tail is what makes an entrance feel
 * alive, and it's also what makes a dismissal feel like the app is reluctant to
 * let go: the moment you've decided to close something, every extra frame reads
 * as lag. So the exit is a short, accelerating ease instead.
 */
export const OVERLAY_SPRING: Transition = { type: "spring", stiffness: 500, damping: 30, mass: 0.65 };

/** The larger, heavier throw a centered modal takes. */
export const OVERLAY_SPRING_SOFT: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.85 };

export const OVERLAY_CLOSE: Transition = { duration: 0.12, ease: [0.32, 0, 0.67, 0] };

/**
 * Opacity is deliberately not on the spring. A spring's approach is asymptotic,
 * and a surface that spends its last 80ms at 97% opacity looks like it's waiting
 * for something. Geometry springs; the fade lands early and gets out of the way.
 */
const FADE_IN: Transition = { duration: 0.13, ease: "easeOut" };

/** How far a surface travels along the axis it opens on. */
const SURFACE_TRAVEL = 6;
const ITEM_TRAVEL = 4;

/** Offset pointing back toward the trigger, so the surface grows out of it. */
function towardTrigger(side: OverlaySide, distance: number): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: 0, y: distance };
    case "bottom":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
  }
}

/**
 * The surface itself. It doesn't just scale — it unfurls: scaleY starts further
 * back than scaleX, which reads as the menu unrolling downward out of its own
 * transform origin rather than a card being zoomed at you. Paired with Radix's
 * `--radix-*-content-transform-origin` the growth starts at the trigger's
 * corner, which is what makes an anchored menu feel attached to the thing that
 * opened it.
 */
export function overlaySurfaceVariants(options: {
  side?: OverlaySide;
  reduced?: boolean;
  /** Cascade the surface's motion children in after it. Menus only. */
  stagger?: boolean;
  spring?: Transition;
} = {}): Variants {
  const { side = "bottom", reduced = false, stagger = false, spring = OVERLAY_SPRING } = options;

  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.12 } },
      exit: { opacity: 0, transition: { duration: 0.09 } },
    };
  }

  const { x, y } = towardTrigger(side, SURFACE_TRAVEL);

  return {
    hidden: { opacity: 0, scaleX: 0.96, scaleY: 0.9, x, y },
    visible: {
      opacity: 1,
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
      transition: {
        ...spring,
        opacity: FADE_IN,
        // 14ms apart: fast enough to read as one movement with a grain to it,
        // slow enough that the eye catches the direction it runs in.
        ...(stagger ? { staggerChildren: 0.014, delayChildren: 0.02 } : {}),
      },
    },
    exit: {
      opacity: 0,
      scaleX: 0.985,
      scaleY: 0.96,
      x: x * 0.35,
      y: y * 0.35,
      transition: OVERLAY_CLOSE,
    },
  };
}

/**
 * Rows inside a menu. They only have an entrance: on the way out the surface
 * fades as one object, because a menu whose rows leave individually looks like
 * it's falling apart rather than closing.
 */
export function overlayItemVariants(options: { side?: OverlaySide; reduced?: boolean } = {}): Variants {
  const { side = "bottom", reduced = false } = options;

  if (reduced) {
    return { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.1 } } };
  }

  const { x, y } = towardTrigger(side, ITEM_TRAVEL);

  return {
    hidden: { opacity: 0, x, y },
    visible: { opacity: 1, x: 0, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } },
  };
}

/**
 * A modal has no trigger to grow out of, so it arrives from slightly below and
 * behind — the one direction that reads as "brought forward" rather than as a
 * corner of the screen.
 */
export function modalContentVariants(reduced = false): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.12 } },
      exit: { opacity: 0, transition: { duration: 0.09 } },
    };
  }

  return {
    hidden: { opacity: 0, scale: 0.94, y: 10 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { ...OVERLAY_SPRING_SOFT, opacity: FADE_IN },
    },
    exit: { opacity: 0, scale: 0.975, y: 4, transition: OVERLAY_CLOSE },
  };
}

/** The scrim. Nothing but opacity — a blur that animates costs a repaint of the whole window. */
export function modalOverlayVariants(): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.16, ease: "easeOut" } },
    exit: { opacity: 0, transition: { duration: 0.12, ease: "easeIn" } },
  };
}
