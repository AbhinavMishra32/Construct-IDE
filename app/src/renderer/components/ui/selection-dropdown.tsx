import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { Expand, Sparkles, X } from "lucide-react";
import type { HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type SelectionDropdownAnchor = { x: number; y: number };
export type SelectionDropdownMode = "anchored" | "floating";

const spring = { type: "spring" as const, stiffness: 430, damping: 38, mass: 0.82 };

export type SelectionDropdownProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "title" | "onAnimationStart" | "onDrag" | "onDragEnd" | "onDragStart"
> & {
  open: boolean;
  anchor?: SelectionDropdownAnchor | null;
  mode?: SelectionDropdownMode;
  expanded?: boolean;
  maxWidth?: number;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  onModeChange?: (mode: SelectionDropdownMode) => void;
  collisionPadding?: number;
  dismissOnInteractOutside?: boolean;
};

export function SelectionDropdown({
  open,
  anchor,
  mode = "anchored",
  expanded = false,
  maxWidth = 520,
  title,
  eyebrow,
  children,
  onDismiss,
  onModeChange,
  collisionPadding = 12,
  dismissOnInteractOutside = mode === "anchored",
  className = "",
  ...props
}: SelectionDropdownProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragControls = useDragControls();
  const [measuredSize, setMeasuredSize] = useState({ width: 320, height: 52 });

  useLayoutEffect(() => {
    if (!open || !surfaceRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setMeasuredSize({
        width: entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width,
        height: entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
      });
    });
    observer.observe(surfaceRef.current);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!dismissOnInteractOutside) return;
      if (!surfaceRef.current?.contains(event.target as Node)) onDismiss?.();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [dismissOnInteractOutside, open, onDismiss]);

  const position = useMemo(() => {
    if (mode === "floating") {
      return {
        left: Math.max(collisionPadding, window.innerWidth - Math.min(520, window.innerWidth - collisionPadding * 2) - 24),
        top: Math.max(collisionPadding, Math.min(92, window.innerHeight - measuredSize.height - collisionPadding)),
      };
    }
    const desiredLeft = anchor?.x ?? collisionPadding;
    const desiredTop = (anchor?.y ?? collisionPadding) + 8;
    const left = Math.min(
      Math.max(collisionPadding, desiredLeft),
      Math.max(collisionPadding, window.innerWidth - measuredSize.width - collisionPadding)
    );
    const below = window.innerHeight - desiredTop;
    const top =
      below >= measuredSize.height + collisionPadding
        ? desiredTop
        : Math.max(collisionPadding, (anchor?.y ?? desiredTop) - measuredSize.height - 8);
    return { left, top };
  }, [anchor?.x, anchor?.y, collisionPadding, measuredSize.height, measuredSize.width, mode]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={surfaceRef}
          layout
          layoutId="selection-dropdown-surface"
          className={cn(
            "fixed z-50 flex min-w-32 flex-col origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
            className
          )}
          data-mode={mode}
          data-slot="selection-dropdown"
          style={{ left: position.left, top: position.top, maxWidth: expanded ? maxWidth : undefined }}
          initial={{ opacity: 0, scale: 0.965, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.975, y: -3 }}
          transition={spring}
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragElastic={0.04}
          {...props}
        >
          {(mode === "floating" || title || eyebrow) ? (
            <header
              className="flex min-h-11 items-center gap-2 border-b px-3 py-2"
              onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
                if (!(event.target as HTMLElement).closest("button, a")) dragControls.start(event);
              }}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                {eyebrow ? (
                  <small className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                    {eyebrow}
                  </small>
                ) : null}
                {title ? (
                  <strong className="block truncate text-sm font-medium">{title}</strong>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 [&_button]:flex [&_button]:size-7 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-md [&_button]:text-muted-foreground [&_button:hover]:bg-muted [&_button:hover]:text-foreground">
                {mode === "anchored" && onModeChange ? (
                  <button
                    type="button"
                    onClick={() => onModeChange("floating")}
                    aria-label="Expand to floating card"
                    title="Expand to floating card"
                  >
                    <Expand size={14} />
                  </button>
                ) : null}
                <button type="button" onClick={onDismiss} aria-label="Close">
                  <X size={14} />
                </button>
              </div>
            </header>
          ) : null}
          <motion.div className={cn("min-h-0", expanded ? "p-2" : "")} layout transition={spring}>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

export type SelectionDropdownItemProps = HTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
};

export function SelectionDropdownItem({
  icon,
  label,
  description,
  className = "",
  ...props
}: SelectionDropdownItemProps) {
  return (
    <button
      className={cn(
        "group/dropdown-menu-item relative flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      type="button"
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
