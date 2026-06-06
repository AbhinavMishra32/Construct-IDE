import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from "react";
import { forwardRef, useLayoutEffect, useRef } from "react";
import "./dialog.css";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export type DialogSize = "narrow" | "feature" | "compact" | "default" | "wide" | "xwide" | "xxwide" | "editor";

export type CodexDialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  contentClassName?: string;
  overlayClassName?: string;
  portalContainer?: HTMLElement | null;
  showDialogClose?: boolean;
  shouldIgnoreClickOutside?: boolean;
  size?: DialogSize;
  unstyledContent?: boolean;
};

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className = "", ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={`codex-dialog-overlay ${className}`} {...props} />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, CodexDialogContentProps>(
  (
    {
      children,
      className = "",
      contentClassName = "",
      overlayClassName = "",
      portalContainer,
      showDialogClose = true,
      shouldIgnoreClickOutside = false,
      size = "default",
      style,
      unstyledContent = false,
      onPointerDown,
      onPointerDownOutside,
      ...props
    },
    forwardedRef,
  ) => {
    const contentRef = useRef<HTMLDivElement | null>(null);
    const heightRef = useRef<HTMLDivElement | null>(null);
    const shouldMeasureHeight =
      !unstyledContent &&
      size !== "editor" &&
      style?.height == null &&
      !/\bh-(?!auto\b)[^\s]+/.test(contentClassName) &&
      !/\bh-(?!auto\b)[^\s]+/.test(className);

    useLayoutEffect(() => {
      if (!shouldMeasureHeight) {
        return;
      }

      const content = contentRef.current;
      const heightNode = heightRef.current;
      if (content == null || heightNode == null || typeof ResizeObserver === "undefined") {
        return;
      }

      let measureFrame: number | null = null;
      let readyFrame: number | null = null;
      let previousHeight = -1;
      let ready = false;

      const setHeight = (nextHeight: number) => {
        if (!Number.isFinite(nextHeight) || Math.abs(nextHeight - previousHeight) < 0.5) {
          return;
        }

        previousHeight = nextHeight;
        content.style.setProperty("--dialog-content-height", `${nextHeight}px`);
        content.style.height = "var(--dialog-content-height)";

        if (!ready) {
          if (readyFrame != null) {
            cancelAnimationFrame(readyFrame);
          }
          readyFrame = requestAnimationFrame(() => {
            ready = true;
            content.dataset.dialogHeightReady = "true";
          });
        }
      };

      const scheduleMeasure = () => {
        measureFrame ??= requestAnimationFrame(() => {
          measureFrame = null;
          setHeight(heightNode.offsetHeight || heightNode.scrollHeight);
        });
      };

      scheduleMeasure();
      const observer = new ResizeObserver(scheduleMeasure);
      observer.observe(heightNode);

      return () => {
        observer.disconnect();
        if (measureFrame != null) {
          cancelAnimationFrame(measureFrame);
        }
        if (readyFrame != null) {
          cancelAnimationFrame(readyFrame);
        }
        content.style.removeProperty("--dialog-content-height");
        content.style.height = "";
        delete content.dataset.dialogHeightReady;
      };
    }, [contentClassName, className, shouldMeasureHeight, size, style?.height, unstyledContent]);

    return (
      <DialogPrimitive.Portal container={portalContainer ?? undefined}>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={(node) => {
            contentRef.current = node;
            if (typeof forwardedRef === "function") {
              forwardedRef(node);
            } else if (forwardedRef != null) {
              forwardedRef.current = node;
            }
          }}
          className={`codex-dialog codex-dialog-size-${size} ${unstyledContent ? "" : "codex-dialog-surface"} ${contentClassName} ${className}`}
          style={style}
          onPointerDown={(event) => {
            event.stopPropagation();
            onPointerDown?.(event);
          }}
          onPointerDownOutside={(event) => {
            if (shouldIgnoreClickOutside) {
              event.preventDefault();
            }
            onPointerDownOutside?.(event);
          }}
          {...props}
        >
          {shouldMeasureHeight ? <div ref={heightRef}>{children}</div> : children}
          {showDialogClose ? (
            <DialogPrimitive.Close className="codex-dialog-close" aria-label="Close">
              <CloseIcon />
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
DialogContent.displayName = "DialogContent";

export function DialogHeader({
  children,
  className = "",
  icon,
  subtitle,
  title,
}: {
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <div className={`codex-dialog-header ${className}`}>
      {icon != null ? <span className="codex-dialog-header-icon">{icon}</span> : null}
      <div className="codex-dialog-header-copy">
        {title != null ? <DialogPrimitive.Title className="codex-dialog-title">{title}</DialogPrimitive.Title> : null}
        {subtitle != null ? (
          <DialogPrimitive.Description className="codex-dialog-description">{subtitle}</DialogPrimitive.Description>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function DialogBody({
  as = "div",
  children,
  className = "",
  size,
  ...props
}: {
  as?: "div" | "form";
  children: ReactNode;
  className?: string;
  size?: "full" | "tall";
} & Record<string, unknown>) {
  const Component = as;
  return (
    <Component className={`codex-dialog-body ${size === "full" ? "codex-dialog-body-full" : ""} ${size === "tall" ? "codex-dialog-body-tall" : ""} ${className}`} {...props}>
      {children}
    </Component>
  );
}

export function DialogFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`codex-dialog-footer ${className}`}>{children}</div>;
}

export function DialogSection({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`codex-dialog-section ${className}`}>{children}</div>;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5" />
    </svg>
  );
}
