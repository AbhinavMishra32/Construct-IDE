import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

/** Long enough to read as the pane moving rather than the layout jumping, short
 *  enough that it never delays the thing you opened it for. Matched to the
 *  window's other panel motion. */
const DURATION = 260;
/** The window's easing, as `arrival.ts` defines it for the screens that use
 *  motion values. Expressed as a function here because this animation is driven
 *  frame by frame rather than by a style. */
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The same curve, written the way CSS wants it. The content's fade and the
 *  pane's travel have to be one movement, not two that happen to overlap. */
const CURVE = "cubic-bezier(0.65, 0, 0.35, 1)";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Opening and closing a resizable pane without the layout jumping.
 *
 * A pane inside a `PanelGroup` cannot be animated with CSS. The group owns every
 * size and writes them as inline styles, so a transition on the element argues
 * with the group for the length of the animation and the drag handle spends it
 * somewhere the panel is not. The size is driven through the panel's own handle
 * instead, one frame at a time, which means the group is doing the layout the
 * whole way — its neighbour grows in step, and the handle is always exactly on
 * the seam.
 *
 * Two things this fixes beyond adding the animation:
 *
 * Closing was an unmount. The pane vanished and its neighbour took the space in
 * a single frame, which is the layout shift that made the terminal feel like a
 * different application from the one that opened it. It now animates shut and
 * unmounts once it has no size left.
 *
 * `resize(0)` did not do what it looked like. `resizePanel` clamps anything
 * below `minSize` up to `minSize`, so a pane with `minSize={10}` opening from
 * zero actually snapped to a tenth of the column and animated the rest — a
 * visible jolt on the first frame. The floor is therefore lifted to zero for
 * exactly as long as the animation runs and restored the moment it settles, so
 * the drag minimum still holds everywhere it is felt.
 */
export function usePanelReveal(
  open: boolean,
  size: number,
  options: {
    /** Called with the pane's size, as a percentage, at the instant it starts
     *  closing. This is what makes a pane reopen at the width you dragged it
     *  to: the group reports layouts continuously, and the last one it reports
     *  before a collapse is not necessarily the one you left the pane at. Read
     *  from the pane itself, it always is. */
    onCollapse?: ((size: number) => void) | undefined;
    /** Hold the content at the width it was laid out at while the pane travels,
     *  so it clips instead of reflowing. Only meaningful for a pane that
     *  animates horizontally — height costs nothing to change. */
    pin?: boolean;
  } = {},
) {
  const panel = useRef<ImperativePanelHandle | null>(null);
  /* Mounted, which trails `open` on the way out — the pane has to still exist
     to be animated shut. */
  const [present, setPresent] = useState(open);
  const [animating, setAnimating] = useState(false);
  /* Fully open at its remembered size. The panel's real `minSize` is only
     applied here — before it, the group would clamp a pane that is meant to be
     at zero up to a tenth of the column. */
  const [arrived, setArrived] = useState(open);
  const frame = useRef(0);
  /* The size to open to, read at the start of a run so a remembered layout
     written mid-animation cannot move the target under it. */
  const target = useRef(size);
  target.current = size;
  const first = useRef(true);
  const collapsed = useRef(options.onCollapse);
  collapsed.current = options.onCollapse;
  const pins = useRef(options.pin === true);
  pins.current = options.pin === true;

  /* The pane's content, and the width to hold it at while the pane moves.

     A pane whose width is animated re-lays-out its contents on every one of
     those frames: paragraphs rewrap, buttons reflow, a composer's rows change
     count. That is the choppiness — it is not the motion, it is fifteen
     different layouts flickering past inside it. Pinned to one width the
     content is laid out once and the pane simply clips it, which is what a
     native sidebar does and why theirs look like a panel sliding rather than a
     page being re-rendered small. */
  const content = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  /* The last width it was actually open at, in pixels — the width to lay the
     content out at on the way back in, before the pane is wide enough to
     measure. */
  const width = useRef<number | null>(null);
  /* Whether the content is faded up. It trails the pane on the way in by a
     frame so there is something to transition from, and leads it on the way out
     so the pane is already empty by the time it is narrow enough to look
     broken. */
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) setPresent(true);
    else setArrived(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useLayoutEffect(() => {
    const handle = panel.current;
    if (!present || !handle) return;

    /* A pane restored open on the first frame is already open. Animating it in
       would make every project you reopen look like it was assembling itself. */
    if (first.current) {
      first.current = false;
      if (open) {
        handle.resize(target.current);
        return;
      }
    }

    /* Taken before anything moves. Once the first frame has run the pane is no
       longer the width the learner left it at, and by the time it unmounts it
       is zero. */
    if (!open) {
      const leaving = handle.getSize();
      if (leaving > 0.01) collapsed.current?.(leaving);
    }

    if (reduced()) {
      if (open) {
        handle.resize(target.current);
        setArrived(true);
      } else setPresent(false);
      return;
    }

    const from = handle.getSize();
    const to = open ? target.current : 0;
    /* Nothing to travel — a toggle flipped back before the last run finished. */
    if (Math.abs(to - from) < 0.01) {
      if (open) setArrived(true);
      else setPresent(false);
      return;
    }

    /* Lay the content out once, and leave it there for the length of the run.
       On the way out that is the width it is standing at; on the way in it is
       the width it closed at, since a pane at zero has nothing to measure. A
       pane that has not been open yet this session falls back to the share of
       the group it is travelling to, which is within a handle's width of right
       — close enough that no line wraps differently when the pin comes off. */
    if (pins.current) {
      const measured = content.current?.offsetWidth ?? 0;
      const group = content.current?.parentElement?.parentElement;
      const share = group ? Math.round((group.clientWidth * to) / 100) : null;
      if (!open && measured > 0) width.current = measured;
      setPinned(open ? (width.current ?? share) : measured > 0 ? measured : width.current);
    }

    setAnimating(true);
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      handle.resize(from + (to - from) * ease(t));
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      setAnimating(false);
      /* Released here, and not before: from now on the pane is being resized by
         the learner, and reflowing is exactly what it should do. */
      setPinned(null);
      if (open) setArrived(true);
      else setPresent(false);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [open, present]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /**
   * Whether a layout the group just reported is worth remembering.
   *
   * Every frame of the animation is a layout change, and every one of them
   * would otherwise be written down — so a pane closed to zero would be
   * remembered as zero wide and reopen to nothing at all.
   */
  const settled = useCallback(() => open && arrived && !animating, [animating, arrived, open]);

  return {
    /** Spread onto the `<Panel>` as its `ref`. */
    panel,
    /** Whether the pane and its handle should be in the tree at all. */
    present,
    /** The floor to give the panel: zero while it is travelling, the real
     *  minimum once it has arrived. */
    minSize: (real: number) => (arrived ? real : 0),
    settled,
    /** Spread onto the one element inside the panel that holds its content.
     *
     *  It is what turns a pane that re-renders itself narrower into a pane that
     *  slides: the width is held for the length of the run so nothing inside
     *  relays out, and the content fades rather than being caught halfway
     *  through rewrapping at the moment it disappears. */
    content: {
      ref: content,
      style: {
        ...(pinned === null ? null : { width: pinned, minWidth: pinned }),
        opacity: shown ? 1 : 0,
        /* Out faster than the pane, and in over its second half — the pane's
           own edges carry the movement, and content arriving with them reads as
           the two being one thing. */
        transition: reduced()
          ? "none"
          : `opacity ${shown ? DURATION * 0.7 : DURATION * 0.45}ms ${CURVE}${shown ? ` ${DURATION * 0.3}ms` : ""}`,
      } satisfies CSSProperties,
    },
  };
}
