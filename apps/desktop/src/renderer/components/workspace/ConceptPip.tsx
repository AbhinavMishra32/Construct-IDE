import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useDragControls, useMotionValue } from "motion/react";
import { GripHorizontal, X } from "lucide-react";

import type { ConceptSummary, ConstructApi } from "../../../shared/api";
import { ConceptEntry } from "../concepts/ConceptEntry";
import {
  DEFAULT_SIZE,
  MARGIN,
  MIN_SIZE,
  anchor,
  fitSize,
  nearest,
  resizeDirection,
  type Corner,
  type Size,
} from "./pipGeometry";

/* Critically damped enough to land without wobble, fast enough to feel attached
   to the finger that threw it. */
const SPRING = { type: "spring" as const, stiffness: 460, damping: 42, mass: 0.9 };

/**
 * A concept, floating over the work.
 *
 * The panel version of this took the conversation's place: opening a concept
 * closed the chat, so reading the idea and reading the answer that raised it
 * were mutually exclusive. That is the one arrangement a concept note cannot
 * have — it exists to be read *against* something.
 *
 * So it detaches instead, and hovers over the editor the way a video does. It
 * is painted in the window's own ground rather than the editor's card, which is
 * what makes it read as a hole cut in the code rather than a window stacked on
 * top of it: the same surface the conversation sits on, in a different place.
 *
 * Position is a corner, not a coordinate. Dragging moves it freely, letting go
 * sends it to whichever corner it was heading for — so it is never left half
 * over the line a learner is reading, and never needs to be placed precisely.
 * Size is free, and grows from the edges facing into the panel so the corner it
 * is pinned to never moves while it is being resized.
 */
export function ConceptPip({
  api,
  concept,
  initial,
  onArrange,
  onClose,
}: {
  api: ConstructApi | undefined;
  concept: ConceptSummary;
  /** Where this project left the card last time. */
  initial?: { corner: Corner; width: number; height: number } | undefined;
  /** Reported whenever the card comes to rest, so the workspace can remember
   *  where it was put. Not called mid-drag: a position is only meaningful once
   *  it is the one the learner chose. */
  onArrange?: ((state: { corner: Corner; width: number; height: number }) => void) | undefined;
  onClose(): void;
}) {
  const field = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [corner, setCorner] = useState<Corner>(initial?.corner ?? "br");
  const controls = useDragControls();
  const x = useMotionValue(MARGIN);
  const y = useMotionValue(MARGIN);

  /* Size lives in motion values as well as state: the values are what the card
     is drawn from, so a resize repaints without re-rendering the entry inside
     it — dragging the handle re-rendering a Markdown body every frame is what
     makes a resize feel like it is catching. State holds the committed size,
     which is what the corner arithmetic reads. */
  const opening: Size = initial ? { width: initial.width, height: initial.height } : DEFAULT_SIZE;
  const width = useMotionValue(opening.width);
  const height = useMotionValue(opening.height);
  const [size, setSize] = useState<Size>(opening);
  const live = useRef<Size>(opening);

  /* The card is positioned entirely by transform, so moving it never touches
     layout and the drag stays on the compositor. */
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const place = useCallback(
    (next: Corner, nextSize: Size, animated: boolean) => {
      if (!bounds.width || !bounds.height) return;
      const target = anchor(next, bounds, nextSize);
      if (animated) {
        void animate(x, target.x, SPRING);
        void animate(y, target.y, SPRING);
      } else {
        x.set(target.x);
        y.set(target.y);
      }
    },
    [bounds, x, y],
  );

  /* Follows the corner it was left in when the panel is resized, rather than
     drifting toward the middle as the space around it changes — and shrinks to
     fit if the panel is dragged narrower than the card. */
  useEffect(() => {
    if (!bounds.width || !bounds.height) return;
    const fitted = fitSize(size, bounds);
    live.current = fitted;
    width.set(fitted.width);
    height.set(fitted.height);
    place(corner, fitted, false);
  }, [bounds, corner, height, place, size, width]);

  const startResize = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const direction = resizeDirection(corner);
    const from = { x: event.clientX, y: event.clientY };
    const start = { ...live.current };

    const move = (moved: PointerEvent) => {
      const next = fitSize(
        {
          width: start.width + (moved.clientX - from.x) * direction.x,
          height: start.height + (moved.clientY - from.y) * direction.y,
        },
        bounds,
      );
      live.current = next;
      width.set(next.width);
      height.set(next.height);
      /* Re-anchored every frame: the pinned corner has to stay still while the
         opposite one follows the pointer, and for three of the four corners
         that means the card's own origin moves as it grows. */
      place(corner, next, false);
    };

    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      /* Committed once, at the end. Setting it per frame would re-render the
         entry on every pixel of the drag. */
      setSize(live.current);
      onArrange?.({ corner, ...live.current });
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  /* The grip sits on the two edges facing into the panel, which is a different
     corner of the card depending on where it is pinned. */
  const grip =
    corner === "br"
      ? "left-0 top-0 cursor-nwse-resize"
      : corner === "bl"
        ? "right-0 top-0 cursor-nesw-resize"
        : corner === "tr"
          ? "bottom-0 left-0 cursor-nesw-resize"
          : "bottom-0 right-0 cursor-nwse-resize";

  /* The field is not clipped: the shadow is drawn outside the card, and a
     wrapper that hid its overflow sliced it off against the panel edge — which
     is what made the lift read as cut out rather than soft. */
  return (
    <div className="pointer-events-none absolute inset-0 z-30" ref={field}>
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        className="app-pip smooth-shadow-ring-xl pointer-events-auto absolute left-0 top-0 flex flex-col overflow-hidden rounded-[var(--radius-xl)]"
        drag
        dragConstraints={field}
        /* The header is the handle. Dragging from the body would fight the
           scroll of the note, which is the one thing this panel is for. */
        dragControls={controls}
        dragElastic={0.06}
        dragListener={false}
        dragMomentum={false}
        exit={{ opacity: 0, scale: 0.96 }}
        initial={{ opacity: 0, scale: 0.96 }}
        onDragEnd={(_event, info) => {
          const next = nearest({ x: x.get(), y: y.get() }, info.velocity, bounds, live.current);
          setCorner(next);
          place(next, live.current, true);
          onArrange?.({ corner: next, ...live.current });
        }}
        style={{ x, y, width, height }}
        transition={SPRING}
      >
        <header
          className="flex h-9 shrink-0 cursor-grab items-center gap-1.5 px-2 active:cursor-grabbing"
          onPointerDown={(event) => controls.start(event)}
        >
          <GripHorizontal className="size-3.5 shrink-0 text-muted-foreground/40" />
          <span className="shrink-0 text-ui-sm font-semibold uppercase tracking-wide text-muted-foreground/60">
            Concept
          </span>
          <button
            aria-label="Close the concept"
            className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {/* A panel floating over the editor must never be able to take the
              window with it: the learner would lose the file they were reading
              to a card they only glanced at. */}
          <PipBoundary>
            <ConceptEntry api={api} concept={concept} />
          </PipBoundary>
        </div>

        <span aria-hidden className={`absolute size-4 ${grip}`} onPointerDown={startResize} />
      </motion.div>
    </div>
  );
}

/**
 * Keeps a failure inside the card inside the card.
 *
 * Says what went wrong rather than showing a blank panel, because the thing
 * that broke is one concept's note and the message is the only way to tell
 * which — and because an IDE that dies over a hover card has lost the file the
 * learner was actually reading.
 */
class PipBoundary extends Component<{ children: ReactNode }, { failure: string | null }> {
  override state: { failure: string | null } = { failure: null };

  static getDerivedStateFromError(cause: unknown) {
    return { failure: cause instanceof Error ? cause.message : "This concept could not be shown." };
  }

  override componentDidCatch(cause: unknown) {
    console.error("Concept card failed to render:", cause);
  }

  override render() {
    if (this.state.failure === null) return this.props.children;
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border/80 px-3 py-2.5">
        <p className="text-content font-medium text-foreground">This concept could not be shown</p>
        <p className="mt-1 break-words text-ui leading-[1.6] text-muted-foreground">{this.state.failure}</p>
      </div>
    );
  }
}
