import { AnimatePresence, motion } from "motion/react";
import { SIDEBAR_SLIDE } from "./sidebarMotion";

/**
 * A control that is in the bar only because the sidebar is not.
 *
 * Collapsing the sidebar moves two things at once: the column slides out, and
 * the controls it was hosting — the way back to it, and the history pair —
 * reappear in the bar on the other side. If those controls simply mount, the
 * row they are in jumps sideways by their full width on the first frame and
 * then sits there while the column spends a quarter of a second travelling. The
 * title lands in its final place before the sidebar has begun to leave, which
 * is the one thing that makes a native window feel like a web page: two halves
 * of a single gesture running on different clocks.
 *
 * So the space they take is animated open on the sidebar's own curve, from
 * nothing. Everything after them in the row is carried along by the same
 * interpolation that carries the column, and nothing anywhere moves in a step.
 *
 * Two details that are not decoration:
 *
 * The negative margin on the way out. A flex gap is paid for a child of zero
 * width exactly as it is for a full one, so without it the row keeps a
 * control's worth of space forever after the control has gone.
 *
 * The fixed inner width. The children are laid out once, at the size they will
 * still be when the animation ends, and the wrapper clips them — the same
 * reason the sidebar itself slides under a clip rather than being re-laid-out
 * narrower sixty times a second. A pair of buttons reflowing inside a box that
 * is itself moving is a shimmer you can see even when you cannot say what it
 * is.
 */
export function SidebarReveal({
  children,
  /** The row's own flex gap, which has to be paid back while this is closed. */
  gap,
  show,
  /** What the children measure when they are up. Animated to, and held. */
  width,
}: {
  children: React.ReactNode;
  gap: number;
  show: boolean;
  width: number;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          animate={{ width, marginRight: 0, opacity: 1 }}
          className="flex shrink-0 items-center overflow-hidden"
          exit={{ width: 0, marginRight: -gap, opacity: 0 }}
          initial={{ width: 0, marginRight: -gap, opacity: 0 }}
          transition={SIDEBAR_SLIDE}
        >
          <div className="flex shrink-0 items-center" style={{ width }}>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** What `NavButtons` measures: two 28px controls and the 2px between them.
 *  Written as the sum so it moves if either of those does. */
export const NAV_BUTTONS_WIDTH = 28 * 2 + 2;
