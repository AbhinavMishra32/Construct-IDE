import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, EllipsisVertical } from "lucide-react";

import { cn } from "../../lib/utils";
import {
  SparMenu,
  SparMenuContent,
  SparMenuItem,
  SparMenuSeparator,
  SparMenuTrigger,
} from "./dropdown-menu";

/**
 * One sidebar row, everywhere.
 *
 * 28px tall at the app's chrome size, which is the AppKit source-list
 * proportion. Every row in the sidebar — nav, action, project, rename field —
 * is this same box, so the list reads as one column rather than as sections
 * built by different hands.
 */
export const SPAR_SIDEBAR_ROW =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui font-normal transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/** A group heading. Sits above its rows in the same gutter, and is never a row
 *  itself — an 11px label at row height would read as a disabled item. */
export function SparSectionLabel({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-6 items-center justify-between px-2 pt-1", className)}>
      <span className="text-ui-sm font-medium text-muted-foreground/70">{children}</span>
      {action}
    </div>
  );
}

/** A collapsed section heading — the disclosure is the label, so the whole thing
 *  is one target rather than a caret beside a word. */
export function SparSectionToggle({
  children,
  count,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  count?: number;
  open: boolean;
  onToggle(): void;
}) {
  return (
    <button
      className="flex h-6 w-full items-center gap-1 px-2 pt-1 text-ui-sm font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
      onClick={onToggle}
      type="button"
    >
      <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      {children}
      {count != null && <span className="tabular-nums text-muted-foreground/50">{count}</span>}
    </button>
  );
}

/** A plain sidebar row: an icon, a label, and optionally a shortcut hint. */
export function SparSidebarAction({
  icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  title,
  badge,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  badge?: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        SPAR_SIDEBAR_ROW,
        active
          ? "bg-[var(--sidebar-accent-active)] text-foreground"
          : "text-foreground/85 hover:bg-[var(--sidebar-accent)]",
        disabled && "pointer-events-none opacity-45",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {icon && <span className="grid size-3.5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {badge}
      {shortcut && <kbd className="font-sans text-ui-sm text-muted-foreground/60">{shortcut}</kbd>}
    </button>
  );
}

export type SparRowMenuItem = {
  /** The letter that runs this item from the keyboard, and the hint shown for it. */
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run(): void;
  destructive?: boolean;
};

/**
 * A list row with everything you can do to it behind ⋮ or a right-click.
 *
 * The trigger is only drawn on hover, but the gutter it sits in is reserved
 * permanently: revealing a control that pushes the title it belongs to is worse
 * than truncating four characters earlier all the time.
 */
export function SparSidebarRow({
  label,
  leading,
  active = false,
  dimmed = false,
  items = [],
  onOpen,
  renaming = false,
  onRenameCommit,
  onRenameCancel,
  title,
}: {
  label: string;
  leading?: React.ReactNode;
  active?: boolean;
  /** Filed away — archived, finished — so it reads as present but retired. */
  dimmed?: boolean;
  items?: SparRowMenuItem[];
  onOpen(): void;
  renaming?: boolean;
  onRenameCommit?(value: string): void;
  onRenameCancel?(): void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  if (renaming && onRenameCommit && onRenameCancel) {
    return (
      <SparRenameRow leading={leading} onCancel={onRenameCancel} onCommit={onRenameCommit} value={label} />
    );
  }

  return (
    <div
      className="group/spar-row relative"
      onContextMenu={
        items.length > 0
          ? (event) => {
              event.preventDefault();
              setOpen(true);
            }
          : undefined
      }
    >
      <button
        className={cn(
          SPAR_SIDEBAR_ROW,
          active
            ? "bg-[var(--sidebar-accent-active)] text-foreground"
            : "text-foreground/80 hover:bg-[var(--sidebar-accent)]",
          dimmed && !active && "text-foreground/55",
        )}
        onClick={onOpen}
        title={title ?? label}
        type="button"
      >
        {leading}
        <span className={cn("min-w-0 flex-1 truncate text-left", items.length > 0 && "pr-5")}>{label}</span>
      </button>

      {items.length > 0 && (
        <SparMenu modal={false} onOpenChange={setOpen} open={open}>
          <SparMenuTrigger asChild>
            <button
              aria-label={`Options for ${label}`}
              className={cn(
                "absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-[var(--radius-sm)]",
                "text-muted-foreground/70 opacity-0 transition-opacity hover:bg-[var(--sidebar-accent-active)] hover:text-foreground",
                "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none group-hover/spar-row:opacity-100",
                open && "bg-[var(--sidebar-accent-active)] text-foreground opacity-100",
              )}
              type="button"
            >
              <EllipsisVertical className="size-3.5" />
            </button>
          </SparMenuTrigger>
          {/* The letters are real: Radix would otherwise spend them on typeahead,
              which moves the highlight and leaves the hint lying about what it does. */}
          <SparMenuContent
            align="start"
            className="min-w-[11.5rem]"
            onKeyDown={(event) => {
              if (event.metaKey || event.ctrlKey || event.altKey) return;
              const item = items.find((entry) => entry.key === event.key.toLowerCase());
              if (!item) return;
              event.preventDefault();
              setOpen(false);
              item.run();
            }}
            side="right"
          >
            {items.map((item) => (
              <Fragment key={item.key}>
                {item.destructive && <SparMenuSeparator />}
                <SparMenuItem onSelect={item.run} variant={item.destructive ? "destructive" : "default"}>
                  <item.icon />
                  <span className="flex-1">{item.label}</span>
                  <kbd className="font-sans text-ui-sm text-muted-foreground/60 uppercase">{item.key}</kbd>
                </SparMenuItem>
              </Fragment>
            ))}
          </SparMenuContent>
        </SparMenu>
      )}
    </div>
  );
}

/** Renaming happens in place. Enter and blur commit, Escape restores the old
 *  value — a dialog for one short string would be more ceremony than the edit. */
function SparRenameRow({
  value,
  leading,
  onCommit,
  onCancel,
}: {
  value: string;
  leading?: React.ReactNode;
  onCommit(next: string): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  /* Claimed twice: the menu that opened this row unmounts in the same commit, and
     the focus its overlay hands back can land after the first attempt. */
  useLayoutEffect(() => {
    const claim = () => {
      if (document.activeElement === input.current) return;
      input.current?.focus();
      input.current?.select();
    };
    claim();
    const frame = requestAnimationFrame(claim);
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const next = input.current?.value.trim() ?? "";
    if (next && next !== value) onCommit(next);
    else onCancel();
  };

  return (
    <div className={cn(SPAR_SIDEBAR_ROW, "bg-[var(--sidebar-accent-active)] text-foreground")}>
      {leading}
      <input
        ref={input}
        aria-label="Rename"
        className="min-w-0 flex-1 bg-transparent text-ui outline-none"
        defaultValue={value}
        maxLength={120}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            committed.current = true;
            onCancel();
          }
        }}
      />
    </div>
  );
}

/** A 6px dot in a 14px box, so a row with a status marker and one without still
 *  line their labels up. */
export function SparStatusDot({ tone = "muted", className }: { tone?: "muted" | "active" | "success" | "warning"; className?: string }) {
  return (
    <span className={cn("grid size-3.5 shrink-0 place-items-center", className)}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "success"
            ? "bg-[var(--construct-success)]"
            : tone === "warning"
              ? "bg-[var(--construct-warning)]"
              : tone === "active"
                ? "bg-foreground/70"
                : "bg-muted-foreground/45",
        )}
      />
    </span>
  );
}

/** The small square control that lives in a section header's hover gutter. */
export function SparSidebarHeaderButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "app-no-drag inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
        className,
      )}
      type="button"
      {...props}
    />
  );
}
